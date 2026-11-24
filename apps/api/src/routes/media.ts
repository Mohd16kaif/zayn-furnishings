import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  Router,
  type Express,
  type Request,
  type Response,
} from "express";
import { rateLimit } from "express-rate-limit";
import { resolveExistingMediaFile } from "../lib/mediaStorage";

const MEDIA_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

function notFound(res: Response): void {
  res.status(404).end();
}

function mediaPathFromRequest(request: Request): string | null {
  const rawPath = request.params.mediaPath;

  if (Array.isArray(rawPath)) {
    return rawPath.join("/");
  }

  return typeof rawPath === "string" ? rawPath : null;
}

export function createMediaRouter(options: {
  mediaDir: string;
}): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many media requests. Please try again shortly.",
    },
  });

  router.use(limiter);

  async function serve(
    request: Request,
    response: Response,
  ): Promise<void> {
    const relativePath = mediaPathFromRequest(request);

    if (!relativePath) {
      notFound(response);
      return;
    }

    try {
      const absolutePath = await resolveExistingMediaFile(
        options.mediaDir,
        relativePath,
      );

      if (!absolutePath) {
        notFound(response);
        return;
      }

      const info = await stat(absolutePath);

      if (!info.isFile()) {
        notFound(response);
        return;
      }

      response.setHeader("Content-Type", "image/webp");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", MEDIA_CACHE_CONTROL);
      response.setHeader(
        "Cross-Origin-Resource-Policy",
        "cross-origin",
      );
      response.setHeader("Content-Length", String(info.size));
      response.status(200);

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      const stream = createReadStream(absolutePath);

      stream.on("error", () => {
        if (!response.headersSent) {
          notFound(response);
          return;
        }

        response.destroy();
      });

      stream.pipe(response);
    } catch {
      notFound(response);
    }
  }

  router.get("/*mediaPath", serve);
  router.head("/*mediaPath", serve);
  router.all("/*mediaPath", (_request, response) => {
    response.setHeader("Allow", "GET, HEAD");
    response.status(405).end();
  });

  return router;
}

export function registerMediaRoute(
  app: Express,
  options: {
    mediaDir: string;
  },
): void {
  app.use(
    "/media",
    createMediaRouter({
      mediaDir: options.mediaDir,
    }),
  );
}
