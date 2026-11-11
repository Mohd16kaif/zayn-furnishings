"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  AdminToast,
  useAdminToast,
} from "@/components/admin/admin-toast";
import {
  adminFetch,
  type AdminCategory,
  type AdminContentBlock,
  type AdminContentType,
  type AdminMe,
} from "@/lib/adminApi";
import { revalidateStorefront } from "@/lib/actions/revalidateStorefront";
import { CONTENT_TABS, contentLimit, contentTab } from "./content-config";
import { ContentForm } from "./content-form";

type BlockStatus = {
  label: "Live" | "Scheduled" | "Expired" | "Hidden";
  className: string;
};

function statusFor(block: AdminContentBlock): BlockStatus {
  if (!block.is_active) {
    return {
      label: "Hidden",
      className: "bg-stone-100 text-stone-600",
    };
  }

  const now = Date.now();
  const startsAt = block.starts_at
    ? new Date(block.starts_at).getTime()
    : null;
  const endsAt = block.ends_at
    ? new Date(block.ends_at).getTime()
    : null;

  if (startsAt !== null && startsAt > now) {
    return {
      label: "Scheduled",
      className: "bg-amber-100 text-amber-900",
    };
  }

  if (endsAt !== null && endsAt < now) {
    return {
      label: "Expired",
      className: "bg-red-100 text-red-800",
    };
  }

  return {
    label: "Live",
    className: "bg-green-100 text-green-800",
  };
}

function secondaryText(block: AdminContentBlock): string {
  if (block.subtitle) {
    return block.subtitle;
  }

  if (block.type === "faq" || block.type === "info_card") {
    return block.body ?? "";
  }

  if (block.link_url) {
    return `Links to ${block.link_url}`;
  }

  return "";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sortBlocks(blocks: AdminContentBlock[]): AdminContentBlock[] {
  return [...blocks].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at),
  );
}

export function ContentClient() {
  const [blocks, setBlocks] = useState<AdminContentBlock[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [role, setRole] = useState<AdminMe["role"] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] =
    useState<AdminContentType>("announcement");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminContentBlock | null>(null);
  const [confirmBlock, setConfirmBlock] =
    useState<AdminContentBlock | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useAdminToast();

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");

    try {
      const [contentData, categoryData, me] = await Promise.all([
        adminFetch<AdminContentBlock[]>("/admin/content"),
        adminFetch<AdminCategory[]>("/admin/categories"),
        adminFetch<AdminMe>("/admin/me"),
      ]);

      setBlocks(contentData);
      setCategories(categoryData);
      setRole(me.role);
      setStatus("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load content.",
      );
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      await Promise.resolve();

      if (!cancelled) {
        await load();
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [load]);

  const tab = contentTab(activeTab);
  const tabBlocks = useMemo(
    () => sortBlocks(blocks.filter((block) => block.type === activeTab)),
    [blocks, activeTab],
  );
  const liveCount = tabBlocks.filter((block) => block.is_active).length;
  const limit = contentLimit(activeTab);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(block: AdminContentBlock) {
    setEditing(block);
    setFormOpen(true);
  }

  async function toggleVisibility(block: AdminContentBlock) {
    setBusyId(block.id);

    try {
      const updated = await adminFetch<AdminContentBlock>(
        `/admin/content/${block.id}`,
        {
          method: "PATCH",
          json: { is_active: !block.is_active },
        },
      );

      setBlocks((previous) =>
        previous.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      );
      await revalidateStorefront();
      showToast(
        "success",
        updated.is_active ? "Content shown on the site." : "Content hidden.",
      );
    } catch (toggleError) {
      showToast(
        "error",
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update the visibility.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function move(block: AdminContentBlock, direction: -1 | 1) {
    const siblings = tabBlocks;
    const index = siblings.findIndex((item) => item.id === block.id);
    const target = index + direction;

    if (index < 0 || target < 0 || target >= siblings.length) {
      return;
    }

    const next = [...siblings];
    [next[index], next[target]] = [next[target], next[index]];

    setBusyId(block.id);

    try {
      await adminFetch("/admin/content/reorder", {
        method: "POST",
        json: next.map((item, position) => ({
          id: item.id,
          sort_order: position,
        })),
      });

      setBlocks((previous) =>
        previous.map((item) => {
          const position = next.findIndex(
            (ordered) => ordered.id === item.id,
          );
          return position === -1
            ? item
            : { ...item, sort_order: position };
        }),
      );
      await revalidateStorefront();
      showToast("success", "Order updated.");
    } catch (moveError) {
      showToast(
        "error",
        moveError instanceof Error
          ? moveError.message
          : "Unable to update the order.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBlock(block: AdminContentBlock) {
    setConfirmBlock(null);
    setBusyId(block.id);

    try {
      await adminFetch(`/admin/content/${block.id}`, {
        method: "DELETE",
      });
      setBlocks((previous) =>
        previous.filter((item) => item.id !== block.id),
      );
      await revalidateStorefront();
      showToast("success", "Content deleted.");
    } catch (deleteError) {
      showToast(
        "error",
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete the content.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaved(
    block: AdminContentBlock,
    created: boolean,
  ) {
    setBlocks((previous) =>
      created
        ? [...previous, block]
        : previous.map((item) =>
            item.id === block.id ? block : item,
          ),
    );

    await revalidateStorefront();

    const savedTab = contentTab(block.type);

    if (created && savedTab.showImage && !block.image_url) {
      setEditing(block);
      setFormOpen(true);
      showToast(
        "success",
        `${capitalize(savedTab.singular)} created. Add a photo to finish.`,
      );
      return;
    }

    setFormOpen(false);
    setEditing(null);
    showToast(
      "success",
      created
        ? `${capitalize(savedTab.singular)} created.`
        : `${capitalize(savedTab.singular)} saved.`,
    );
  }

  function handleImageChanged(blockId: string, imageUrl: string | null) {
    setBlocks((previous) =>
      previous.map((item) =>
        item.id === blockId ? { ...item, image_url: imageUrl } : item,
      ),
    );
    setEditing((previous) =>
      previous && previous.id === blockId
        ? { ...previous, image_url: imageUrl }
        : previous,
    );
    void revalidateStorefront();
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-400">
            Store
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Content
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Manage the announcement bar and the sections on your homepage.
            Changes appear on the store within seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          Add {tab.singular}
        </button>
      </div>

      <AdminToast toast={toast} onDismiss={dismissToast} />

      <div className="mt-6 border-b border-stone-200">
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Content types"
        >
          {CONTENT_TABS.map((item) => {
            const isActive = item.type === activeTab;

            return (
              <button
                key={item.type}
                type="button"
                role="tab"
                id={`content-tab-${item.type}`}
                aria-selected={isActive}
                aria-controls={`content-panel-${item.type}`}
                onClick={() => setActiveTab(item.type)}
                className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
                  isActive
                    ? "border-b-2 border-stone-900 text-stone-900"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`content-panel-${activeTab}`}
        aria-labelledby={`content-tab-${activeTab}`}
        className="mt-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
          <p className="text-sm text-stone-700">
            <span className="font-semibold text-stone-900">
              {liveCount} of {limit}
            </span>{" "}
            {tab.plural} live
          </p>
          <p className="text-xs text-stone-500">
            {liveCount >= limit
              ? `You have reached the live limit for ${tab.plural}. Hide one before showing another.`
              : `You can show up to ${limit} ${tab.plural} at once.`}
          </p>
        </div>

        {status === "loading" ? (
          <p className="mt-6 rounded-2xl border border-stone-200 bg-white px-4 py-10 text-center text-sm text-stone-500">
            Loading content...
          </p>
        ) : null}

        {status === "error" ? (
          <div className="mt-6 rounded-2xl border border-stone-200 bg-white px-4 py-10 text-center">
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Try again
            </button>
          </div>
        ) : null}

        {status === "ready" ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            {tabBlocks.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-stone-500">
                No {tab.plural} yet. Use the button above to add one.
              </p>
            ) : (
              tabBlocks.map((block, index) => {
                const badge = statusFor(block);
                const busy = busyId === block.id;
                const secondary = secondaryText(block);

                return (
                  <div
                    key={block.id}
                    className="flex flex-col gap-4 border-b border-stone-100 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {block.image_url ? (
                        <Image
                          src={block.image_url}
                          alt=""
                          width={96}
                          height={72}
                          className="h-16 w-24 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-[10px] uppercase tracking-wide text-stone-400">
                          No photo
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-stone-900">
                          {block.title ?? "Untitled"}
                        </p>
                        {secondary ? (
                          <p className="mt-1 line-clamp-2 text-xs text-stone-500">
                            {secondary}
                          </p>
                        ) : null}
                        <span
                          className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void move(block, -1)}
                        disabled={busy || index === 0}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Move ${block.title ?? "item"} up`}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(block, 1)}
                        disabled={busy || index === tabBlocks.length - 1}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Move ${block.title ?? "item"} down`}
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(block)}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleVisibility(block)}
                        disabled={busy}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {block.is_active ? "Hide" : "Show"}
                      </button>
                      {role === "owner" ? (
                        <button
                          type="button"
                          onClick={() => setConfirmBlock(block)}
                          disabled={busy}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      {formOpen ? (
        <ContentForm
          key={editing?.id ?? "new"}
          type={activeTab}
          block={editing}
          categories={categories}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={handleSaved}
          onImageChanged={handleImageChanged}
          onToast={showToast}
        />
      ) : null}

      <ConfirmDialog
        open={confirmBlock !== null}
        title="Delete this content?"
        description={
          confirmBlock
            ? `"${confirmBlock.title ?? "Untitled"}" will be permanently removed from the site. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete content"
        busy={busyId === confirmBlock?.id}
        onCancel={() => setConfirmBlock(null)}
        onConfirm={() => {
          if (confirmBlock) {
            void deleteBlock(confirmBlock);
          }
        }}
      />
    </div>
  );
}
