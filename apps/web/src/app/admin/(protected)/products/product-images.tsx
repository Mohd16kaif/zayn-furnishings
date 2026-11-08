"use client";

import Image from "next/image";
import { useRef, useState, type DragEvent } from "react";
import {
  adminFetch,
  adminUpload,
  AdminApiError,
  type AdminProductImage,
} from "@/lib/adminApi";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 10;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const buttonClass =
  "rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40";

type FileIssue = {
  name: string;
  message: string;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError || error instanceof Error) {
    return error.message;
  }

  return fallback;
}

export function ProductImages({
  productId,
  initialImages,
}: {
  productId: string;
  initialImages: AdminProductImage[];
}) {
  const [images, setImages] = useState<AdminProductImage[]>(initialImages);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialImages.map((image) => [image.id, image.alt_text ?? ""]),
    ),
  );
  const [altErrors, setAltErrors] = useState<Record<string, string>>({});
  const [savingAltId, setSavingAltId] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileIssues, setFileIssues] = useState<FileIssue[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const files = Array.from(fileList);
    const remaining = MAX_IMAGES - images.length;
    const issues: FileIssue[] = [];
    const accepted: File[] = [];

    for (const file of files) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        issues.push({
          name: file.name,
          message: "Use a JPG, PNG, or WebP photo.",
        });
        continue;
      }

      if (file.size > MAX_BYTES) {
        issues.push({
          name: file.name,
          message: "This photo is larger than 8 MB.",
        });
        continue;
      }

      accepted.push(file);
    }

    setFileIssues(issues);
    setUploadError("");
    setNotice("");

    if (remaining <= 0) {
      setUploadError(
        `This product already has ${MAX_IMAGES} photos. Delete one before adding another.`,
      );
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      return;
    }

    const allowed = accepted.slice(0, remaining);

    for (const file of accepted.slice(remaining)) {
      issues.push({
        name: file.name,
        message: `You can add ${remaining} more photo${
          remaining === 1 ? "" : "s"
        } to reach the ${MAX_IMAGES} photo limit.`,
      });
    }

    if (allowed.length === 0) {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      return;
    }

    const formData = new FormData();

    for (const file of allowed) {
      formData.append("files", file);
    }

    setFileIssues([...issues]);
    setUploading(true);
    setUploadProgress(0);

    try {
      const uploaded = await adminUpload<AdminProductImage[]>(
        `/admin/products/${productId}/images`,
        formData,
        setUploadProgress,
      );

      setImages((previous) => [...previous, ...uploaded]);
      setAltDrafts((previous) => {
        const next = { ...previous };
        for (const image of uploaded) {
          next[image.id] = image.alt_text ?? "";
        }
        return next;
      });
      setNotice(
        `${uploaded.length} photo${uploaded.length === 1 ? "" : "s"} added.`,
      );
    } catch (error) {
      setUploadError(
        errorMessage(error, "Unable to upload the photos. Please try again."),
      );
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function persistOrder(next: AdminProductImage[]) {
    setReordering(true);
    setUploadError("");
    setNotice("");

    try {
      const updated = await adminFetch<AdminProductImage[]>(
        `/admin/products/${productId}/images/reorder`,
        {
          method: "PATCH",
          json: next.map((image, index) => ({
            id: image.id,
            sort_order: index,
          })),
        },
      );
      setImages(updated);
      setNotice("Photo order updated.");
    } catch (error) {
      setUploadError(
        errorMessage(error, "Unable to reorder the photos. Please try again."),
      );
    } finally {
      setReordering(false);
    }
  }

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= images.length) {
      return;
    }

    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    void persistOrder(next);
  }

  function makeMain(index: number) {
    if (index <= 0) {
      return;
    }

    const next = [
      images[index],
      ...images.slice(0, index),
      ...images.slice(index + 1),
    ];
    void persistOrder(next);
  }

  async function saveAltText(image: AdminProductImage) {
    const value = (altDrafts[image.id] ?? "").trim();

    if (value.length > 200) {
      setAltErrors((previous) => ({
        ...previous,
        [image.id]: "Keep the description under 200 characters.",
      }));
      return;
    }

    setSavingAltId(image.id);
    setAltErrors((previous) => {
      const next = { ...previous };
      delete next[image.id];
      return next;
    });

    try {
      const updated = await adminFetch<AdminProductImage>(
        `/admin/products/${productId}/images/${image.id}`,
        {
          method: "PATCH",
          json: { alt_text: value || null },
        },
      );

      setImages((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      setAltDrafts((previous) => ({
        ...previous,
        [image.id]: updated.alt_text ?? "",
      }));
      setNotice("Photo description saved.");
    } catch (error) {
      setAltErrors((previous) => ({
        ...previous,
        [image.id]: errorMessage(
          error,
          "Unable to save the description. Please try again.",
        ),
      }));
    } finally {
      setSavingAltId(null);
    }
  }

  async function removeImage(image: AdminProductImage) {
    const confirmed = window.confirm(
      "Delete this photo? This cannot be undone.",
    );

    if (!confirmed) {
      return;
    }

    setBusyImageId(image.id);
    setUploadError("");
    setNotice("");

    try {
      await adminFetch(`/admin/products/${productId}/images/${image.id}`, {
        method: "DELETE",
      });
      setImages((previous) =>
        previous.filter((item) => item.id !== image.id),
      );
      setAltDrafts((previous) => {
        const next = { ...previous };
        delete next[image.id];
        return next;
      });
      setNotice("Photo deleted.");
    } catch (error) {
      setUploadError(
        errorMessage(error, "Unable to delete the photo. Please try again."),
      );
    } finally {
      setBusyImageId(null);
    }
  }

  const actionsDisabled = uploading || reordering || busyImageId !== null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-stone-900">Images</h2>
          <p className="mt-1 text-sm text-stone-600">
            Use clear, bright photos. JPG, PNG or WebP, up to 8 MB each. Up to
            10 photos per product.
          </p>
        </div>
        <p className="text-xs text-stone-500">
          {images.length} of {MAX_IMAGES} photos
        </p>
      </div>

      <div
        className={`mt-4 rounded-2xl border-2 border-dashed p-5 text-center transition ${
          dragging
            ? "border-stone-900 bg-stone-50"
            : "border-stone-300 bg-stone-50/60"
        }`}
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
      >
        <p className="text-sm font-medium text-stone-800">
          Drag photos here
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Or choose them from your computer.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || images.length >= MAX_IMAGES}
          className="mt-3 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Choose photos
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      {uploading ? (
        <div className="mt-3" aria-live="polite">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-stone-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={uploadProgress ?? 0}
          >
            <div
              className="h-full bg-stone-900 transition-all"
              style={{ width: `${uploadProgress ?? 0}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-stone-600">
            Uploading... {uploadProgress ?? 0}%
          </p>
        </div>
      ) : null}

      {fileIssues.length > 0 ? (
        <ul className="mt-3 space-y-1" role="alert">
          {fileIssues.map((issue, index) => (
            <li
              key={`${issue.name}-${index}`}
              className="text-xs text-red-700"
            >
              <span className="font-medium">{issue.name}</span>:{" "}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {uploadError ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {uploadError}
        </p>
      ) : null}

      {notice ? (
        <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      {images.length === 0 ? (
        <p className="mt-5 text-sm text-stone-500">
          No photos yet. Add the first one above.
        </p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {images.map((image, index) => {
            const draft = altDrafts[image.id] ?? "";
            const isSaved = draft === (image.alt_text ?? "");

            return (
              <div
                key={image.id}
                className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
              >
                <div className="relative bg-stone-100">
                  <Image
                    src={image.url}
                    alt={image.alt_text ?? "Product photo"}
                    width={400}
                    height={400}
                    className="h-48 w-full object-cover"
                  />
                  {index === 0 ? (
                    <span className="absolute left-2 top-2 rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                      Main photo
                    </span>
                  ) : null}
                </div>

                <div className="space-y-3 p-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => moveImage(index, -1)}
                      disabled={actionsDisabled || index === 0}
                      className={buttonClass}
                      aria-label={`Move photo ${index + 1} earlier`}
                    >
                      Move earlier
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(index, 1)}
                      disabled={
                        actionsDisabled || index === images.length - 1
                      }
                      className={buttonClass}
                      aria-label={`Move photo ${index + 1} later`}
                    >
                      Move later
                    </button>
                    {index > 0 ? (
                      <button
                        type="button"
                        onClick={() => void makeMain(index)}
                        disabled={actionsDisabled}
                        className={buttonClass}
                      >
                        Make main photo
                      </button>
                    ) : null}
                  </div>

                  <div>
                    <label
                      htmlFor={`image-alt-${image.id}`}
                      className="block text-xs font-medium text-stone-700"
                    >
                      Describe the photo for shoppers and screen readers
                    </label>
                    <input
                      id={`image-alt-${image.id}`}
                      value={draft}
                      maxLength={200}
                      onChange={(event) =>
                        setAltDrafts((previous) => ({
                          ...previous,
                          [image.id]: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10"
                    />
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-stone-400">
                        {draft.length}/200
                      </span>
                      <button
                        type="button"
                        onClick={() => void saveAltText(image)}
                        disabled={savingAltId === image.id || isSaved}
                        className={buttonClass}
                      >
                        {savingAltId === image.id
                          ? "Saving..."
                          : isSaved
                            ? "Saved"
                            : "Save description"}
                      </button>
                    </div>
                    {altErrors[image.id] ? (
                      <p role="alert" className="mt-1 text-xs text-red-700">
                        {altErrors[image.id]}
                      </p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => void removeImage(image)}
                    disabled={actionsDisabled}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyImageId === image.id
                      ? "Deleting..."
                      : "Delete photo"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
