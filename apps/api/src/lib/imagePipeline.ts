import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import { HttpError } from "./adminCatalog";
import { getSupabaseAdmin } from "./supabase";

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type DetectedImageType = "jpeg" | "png" | "webp";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function detectImageType(
  buffer: Buffer,
): DetectedImageType | null {
  if (!buffer || buffer.length === 0) {
    return null;
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return "png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

export type ProcessImageOptions = {
  width: number;
  height?: number;
};

export async function processImage(
  buffer: Buffer,
  options?: ProcessImageOptions,
): Promise<Buffer> {
  const resize = options
    ? {
        width: options.width,
        height: options.height,
        fit: "inside" as const,
        withoutEnlargement: true,
      }
    : {
        width: 2000,
        height: 2000,
        fit: "inside" as const,
        withoutEnlargement: true,
      };

  return sharp(buffer, { failOn: "error" })
    .rotate()
    .resize(resize)
    .webp({ quality: 82 })
    .toBuffer();
}

function imageStorage() {
  return getSupabaseAdmin().storage.from(PRODUCT_IMAGES_BUCKET);
}

export async function uploadImageObject(input: {
  folder: string;
  ownerId: string;
  buffer: Buffer;
  errorMessage: string;
}): Promise<{ path: string; url: string }> {
  const path = `${input.folder}/${input.ownerId}/${randomUUID()}.webp`;
  const storage = imageStorage();

  const { error } = await storage.upload(path, input.buffer, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });

  if (error) {
    throw new HttpError(500, input.errorMessage);
  }

  const { data } = storage.getPublicUrl(path);

  return { path, url: data.publicUrl };
}

export async function deleteImageObjects(
  paths: string[],
  logLabel = "image objects",
): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  try {
    const { error } = await imageStorage().remove(paths);
    if (error) {
      console.error(`Failed to delete ${logLabel}:`, error.message);
    }
  } catch (error) {
    console.error(
      `Failed to delete ${logLabel}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export function createImageUploadLimiter(message: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.admin?.id ?? "anonymous",
    message: { error: message },
  });
}

export function createImageUploadMiddleware(options: {
  field: string;
  maxFiles: number;
  fileSizeMessage: string;
  countMessage: string;
  genericMessage: string;
}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_IMAGE_BYTES,
      files: options.maxFiles,
    },
  });

  return function imageUploadMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    upload.array(options.field, options.maxFiles)(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: options.fileSizeMessage });
          return;
        }

        if (
          error.code === "LIMIT_FILE_COUNT" ||
          error.code === "LIMIT_UNEXPECTED_FILE"
        ) {
          res.status(400).json({ error: options.countMessage });
          return;
        }

        res.status(400).json({ error: options.genericMessage });
        return;
      }

      next(error);
    });
  };
}

export const singleImageUploadLimiter = createImageUploadLimiter(
  "Too many image uploads. Please wait a few minutes and try again.",
);

export const singleImageUpload = createImageUploadMiddleware({
  field: "file",
  maxFiles: 1,
  fileSizeMessage: "The image must be 8 MB or smaller.",
  countMessage: 'Upload one image using the "file" field.',
  genericMessage:
    "The image could not be uploaded. Please try again.",
});
