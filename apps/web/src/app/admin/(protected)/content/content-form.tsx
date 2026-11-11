"use client";

import { useState, type FormEvent } from "react";
import {
  validateContentDateRange,
  validateContentLink,
  type ContentType,
} from "@zayn/shared";
import { SingleImageUploader } from "@/components/admin/single-image-uploader";
import type { ToastKind } from "@/components/admin/admin-toast";
import {
  AdminApiError,
  adminFetch,
  type AdminCategory,
  type AdminContentBlock,
} from "@/lib/adminApi";
import { contentTab } from "./content-config";
import { ContentLinkPicker } from "./content-link-picker";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 disabled:bg-stone-100 disabled:text-stone-500";

const helpClass = "mt-1 text-xs leading-5 text-stone-500";

function toDatetimeLocal(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (part: number) => String(part).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function titleFor(type: ContentType): string {
  switch (type) {
    case "announcement":
      return "Message";
    case "hero":
      return "Headline";
    case "room_tile":
      return "Room name";
    case "info_card":
      return "Title";
    case "faq":
      return "Question";
    default:
      return "Title";
  }
}

export function ContentForm({
  type,
  block,
  categories,
  onClose,
  onSaved,
  onImageChanged,
  onToast,
}: {
  type: ContentType;
  block: AdminContentBlock | null;
  categories: AdminCategory[];
  onClose: () => void;
  onSaved: (
    block: AdminContentBlock,
    created: boolean,
  ) => Promise<void>;
  onImageChanged: (blockId: string, imageUrl: string | null) => void;
  onToast: (kind: ToastKind, message: string) => void;
}) {
  const tab = contentTab(type);
  const isHero = type === "hero";
  const isRoomTile = type === "room_tile";
  const isAnnouncement = type === "announcement";
  const isInfoCard = type === "info_card";
  const isFaq = type === "faq";
  const showImage = tab.showImage;

  const [title, setTitle] = useState(block?.title ?? "");
  const [subtitle, setSubtitle] = useState(block?.subtitle ?? "");
  const [body, setBody] = useState(block?.body ?? "");
  const [buttonText, setButtonText] = useState(block?.button_text ?? "");
  const [linkUrl, setLinkUrl] = useState<string | null>(
    block?.link_url ?? null,
  );
  const [startsAt, setStartsAt] = useState(
    toDatetimeLocal(block?.starts_at ?? null),
  );
  const [endsAt, setEndsAt] = useState(
    toDatetimeLocal(block?.ends_at ?? null),
  );
  const [isActive, setIsActive] = useState(
    block?.is_active ?? !isHero,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(
    block?.image_url ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(
    {},
  );

  const canBeActive = !isHero || Boolean(imageUrl);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setFieldErrors({});

    const nextTitle = title.trim();

    if (!nextTitle) {
      setFieldErrors({ title: `${titleFor(type)} is required.` });
      setSaving(false);
      return;
    }

    if ((isInfoCard || isFaq) && !body.trim()) {
      setFieldErrors({
        body: isFaq ? "Answer is required." : "Text is required.",
      });
      setSaving(false);
      return;
    }

    const linkError = validateContentLink(linkUrl);

    if (linkError) {
      setFieldErrors({ link_url: linkError });
      setSaving(false);
      return;
    }

    const nextStartsAt = isHero ? toIso(startsAt) : null;
    const nextEndsAt = isHero ? toIso(endsAt) : null;
    const dateError = isHero
      ? validateContentDateRange(nextStartsAt, nextEndsAt)
      : null;

    if (dateError) {
      setFieldErrors({ ends_at: dateError });
      setSaving(false);
      return;
    }

    if (isHero && isActive && !imageUrl) {
      setFieldErrors({
        image_url: "Add a photo before making this banner visible.",
      });
      setSaving(false);
      return;
    }

    const payload: Record<string, unknown> = {
      title: nextTitle,
    };

    if (isAnnouncement || isHero) {
      payload.subtitle = subtitle.trim() || null;
      payload.button_text = buttonText.trim() || null;
      payload.link_url = linkUrl;
    }

    if (isHero) {
      payload.starts_at = nextStartsAt;
      payload.ends_at = nextEndsAt;
      payload.is_active = isActive && canBeActive;
    }

    if (isRoomTile) {
      payload.link_url = linkUrl;
      payload.is_active = isActive;
    }

    if (isInfoCard || isFaq) {
      payload.body = body.trim();
    }

    try {
      const result = block
        ? await adminFetch<AdminContentBlock>(
            `/admin/content/${block.id}`,
            { method: "PATCH", json: payload },
          )
        : await adminFetch<AdminContentBlock>("/admin/content", {
            method: "POST",
            json: { type, ...payload },
          });

      await onSaved(result, !block);
    } catch (saveError) {
      if (saveError instanceof AdminApiError) {
        setFieldErrors(saveError.fields ?? {});
      }

      const message =
        saveError instanceof Error
          ? saveError.message
          : "Unable to save. Please try again.";
      setError(message);
      onToast("error", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-form-title"
        className="w-full max-w-2xl rounded-2xl border border-stone-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="content-form-title"
            className="text-lg font-semibold text-stone-900"
          >
            {block ? `Edit ${tab.singular}` : `Add ${tab.singular}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 px-3 py-1 text-sm text-stone-600 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5" noValidate>
          <div>
            <label
              htmlFor="content-title"
              className="block text-sm font-medium text-stone-800"
            >
              {titleFor(type)}
            </label>
            <input
              id="content-title"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(fieldErrors.title)}
            />
            {isAnnouncement ? (
              <p className={helpClass}>
                Type{" "}
                <code className="rounded bg-stone-100 px-1 py-0.5 text-[11px] text-stone-800">
                  {"{{free_delivery_threshold}}"}
                </code>{" "}
                to insert your current free-delivery amount automatically.
              </p>
            ) : null}
            {fieldErrors.title ? (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {fieldErrors.title}
              </p>
            ) : null}
          </div>

          {isAnnouncement || isHero ? (
            <div>
              <label
                htmlFor="content-subtitle"
                className="block text-sm font-medium text-stone-800"
              >
                {isAnnouncement
                  ? "Second line (optional)"
                  : "Short text (optional)"}
              </label>
              <input
                id="content-subtitle"
                value={subtitle}
                maxLength={200}
                onChange={(event) => setSubtitle(event.target.value)}
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.subtitle)}
              />
              {isAnnouncement ? (
                <p className={helpClass}>
                  The same free-delivery placeholder works here too.
                </p>
              ) : null}
              {fieldErrors.subtitle ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.subtitle}
                </p>
              ) : null}
            </div>
          ) : null}

          {isInfoCard || isFaq ? (
            <div>
              <label
                htmlFor="content-body"
                className="block text-sm font-medium text-stone-800"
              >
                {isFaq ? "Answer" : "Text"}
              </label>
              <textarea
                id="content-body"
                value={body}
                rows={isFaq ? 5 : 4}
                maxLength={2000}
                onChange={(event) => setBody(event.target.value)}
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.body)}
              />
              <p className={helpClass}>
                {isFaq
                  ? "Keep the answer clear and easy to scan."
                  : "A short, helpful paragraph for shoppers."}
              </p>
              {fieldErrors.body ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.body}
                </p>
              ) : null}
            </div>
          ) : null}

          {isAnnouncement || isHero ? (
            <div>
              <label
                htmlFor="content-button-text"
                className="block text-sm font-medium text-stone-800"
              >
                Button text (optional)
              </label>
              <input
                id="content-button-text"
                value={buttonText}
                maxLength={40}
                onChange={(event) => setButtonText(event.target.value)}
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.button_text)}
              />
              <p className={helpClass}>
                Shown only when a link is also chosen.
              </p>
              {fieldErrors.button_text ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.button_text}
                </p>
              ) : null}
            </div>
          ) : null}

          {isAnnouncement || isHero || isRoomTile ? (
            <ContentLinkPicker
              value={linkUrl}
              categories={categories}
              onChange={setLinkUrl}
              fieldError={fieldErrors.link_url}
              disabled={saving}
            />
          ) : null}

          {showImage ? (
            <div>
              <p className="text-sm font-medium text-stone-800">Photo</p>
              {block ? (
                <div className="mt-2">
                  <SingleImageUploader
                    endpoint={`/admin/content/${block.id}/image`}
                    imageUrl={imageUrl}
                    alt={title.trim() || tab.singular}
                    helpText={
                      isHero
                        ? "Wide photo, at least 1600px wide. JPG, PNG, or WebP, up to 8 MB."
                        : "About 1200px wide works best. JPG, PNG, or WebP, up to 8 MB."
                    }
                    disabled={saving}
                    onChanged={(nextUrl) => {
                      setImageUrl(nextUrl);
                      if (block) {
                        onImageChanged(block.id, nextUrl);
                      }
                    }}
                    onToast={onToast}
                  />
                </div>
              ) : (
                <p className={`${helpClass} rounded-lg border border-stone-200 bg-stone-50 px-3 py-2`}>
                  Save this {tab.singular} first, then add its photo.
                </p>
              )}
              {fieldErrors.image_url ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.image_url}
                </p>
              ) : null}
            </div>
          ) : null}

          {isHero ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="content-starts-at"
                  className="block text-sm font-medium text-stone-800"
                >
                  Starts showing (optional)
                </label>
                <input
                  id="content-starts-at"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  className={inputClass}
                  aria-invalid={Boolean(fieldErrors.starts_at)}
                />
                {fieldErrors.starts_at ? (
                  <p role="alert" className="mt-1 text-xs text-red-700">
                    {fieldErrors.starts_at}
                  </p>
                ) : null}
              </div>
              <div>
                <label
                  htmlFor="content-ends-at"
                  className="block text-sm font-medium text-stone-800"
                >
                  Stops showing (optional)
                </label>
                <input
                  id="content-ends-at"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  className={inputClass}
                  aria-invalid={Boolean(fieldErrors.ends_at)}
                />
                {fieldErrors.ends_at ? (
                  <p role="alert" className="mt-1 text-xs text-red-700">
                    {fieldErrors.ends_at}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {isHero || isRoomTile ? (
            <div>
              <label className="flex items-center gap-2 text-sm text-stone-800">
                <input
                  type="checkbox"
                  checked={isActive && canBeActive}
                  disabled={saving || !canBeActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  className="h-4 w-4 rounded border-stone-300"
                />
                {isHero
                  ? "Visible on the homepage"
                  : "Show this room tile"}
              </label>
              {!canBeActive ? (
                <p className={helpClass}>
                  A banner needs a photo before it can be visible.
                </p>
              ) : null}
              {fieldErrors.is_active ? (
                <p role="alert" className="mt-1 text-xs text-red-700">
                  {fieldErrors.is_active}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : `Save ${tab.singular}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
