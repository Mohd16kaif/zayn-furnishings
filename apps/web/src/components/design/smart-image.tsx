"use client";

import Image from "next/image";
import { useState } from "react";

type SmartImageProps = {
  src?: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  tone?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  label?: string;
};

export function SmartImage({
  src,
  alt,
  sizes,
  priority = false,
  tone = 1,
  className = "",
  label = "Photo",
}: SmartImageProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div className={`zf-photo zf-photo--${tone} ${className}`.trim()}>
      {showImage ? (
        <Image
          src={src as string}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="zf-image"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="zf-photo__placeholder" role="img" aria-label={alt}>
          <span className="zf-photo__label">{label}</span>
        </div>
      )}
    </div>
  );
}
