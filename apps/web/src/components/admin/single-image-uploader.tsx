"use client";

import Image from "next/image";
import { useRef, useState, type DragEvent } from "react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  AdminApiError,
  adminFetch,
  adminUpload,
} from "@/lib/adminApi";
import type { ToastKind } from "@/components/admin/admin-toast";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError || error instanceof Error) {
    return error.message;
  }

  return fallback;
}

export function SingleImageUploader({
  endpoint,
  imageUrl,
  helpText,
  alt,
  disabled = false,
  onChanged,
  onToast,
}: {
  endpoint: string;
  imageUrl: string | null;
  helpText: string;
  alt: string;
  disabled?: boolean;
  onChanged: (imageUrl: string | null) => void;
  onToast: (kind: ToastKind, message: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];

    if (!file || uploading || disabled) {
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Use a JPG, PNG, or WebP photo.");
      return;
    }

    if (file.size > MAX_BYTES) {
      setError("This photo is larger than 8 MB.");
      return;
    }

    setError("");
    setUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const updated = await adminUpload<{ image_url: string | null }>(
        endpoint,
        formData,
        setProgress,
      );

      onChanged(updated.image_url);
      onToast("success", "Photo saved.");
    } catch (uploadError) {
      const message = errorMessage(
        uploadError,
        "Unable to upload the photo. Please try again.",
      );
      setError(message);
      onToast("error", message);
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function removeImage() {
    setConfirmRemove(false);
    setError("");
    setUploading(true);
    setProgress(0);

    try {
      const updated = await adminFetch<{ image_url: string | null }>(
        endpoint,
        { method: "DELETE" },
      );

      onChanged(updated.image_url);
      onToast("success", "Photo removed.");
    } catch (removeError) {
      const message = errorMessage(
        removeError,
        "Unable to remove the photo. Please try again.",
      );
      setError(message);
      onToast("error", message);
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || disabled;

  return (
    <div>
      {imageUrl ? (
        <div className="overflow-hidden rounded-lg border border-stone-200">
          <div className="relative bg-stone-100">
            <Image
              src={imageUrl}
              alt={alt}
              width={800}
              height={450}
              className="h-40 w-full object-cover"
            />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-stone-200 p-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Replace photo
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove photo
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`rounded-lg border-2 border-dashed p-5 text-center transition ${
            dragging
              ? "border-stone-900 bg-stone-50"
              : "border-stone-300 bg-stone-50/60"
          }`}
          onDragOver={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            if (!busy) {
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            setDragging(false);
            void handleFiles(event.dataTransfer.files);
          }}
        >
          <p className="text-sm font-medium text-stone-800">
            Drag a photo here
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Or choose one from your computer.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mt-3 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Choose photo
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <p className="mt-2 text-xs text-stone-500">{helpText}</p>

      {uploading ? (
        <div className="mt-3" aria-live="polite">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-stone-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full bg-stone-900 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-stone-600">
            {progress > 0 ? `Uploading... ${progress}%` : "Working..."}
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove this photo?"
        description="The photo will be removed. You can add a new one at any time."
        confirmLabel="Remove photo"
        busy={uploading}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void removeImage()}
      />
    </div>
  );
}
