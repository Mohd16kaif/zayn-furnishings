import sharp from "sharp";
import { detectImageType, processImage } from "../lib/imageProcessing";

const createImage = () =>
  sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: { r: 220, g: 210, b: 200 },
    },
  });

async function main() {
  const png = await createImage().png().toBuffer();
  const jpeg = await createImage().jpeg().toBuffer();
  const webp = await createImage().webp().toBuffer();
  const text = Buffer.from("This is a text file renamed to look like a photo.");

  let jpegWithExif = jpeg;
  let inputHasExif = false;

  try {
    jpegWithExif = await createImage()
      .jpeg()
      .withMetadata({
        exif: {
          IFD0: {
            Copyright: "verify-images",
            Software: "verifyImages",
          },
        },
      })
      .toBuffer();
    inputHasExif = Boolean((await sharp(jpegWithExif).metadata()).exif);
  } catch {
    inputHasExif = false;
  }

  const output = await processImage(jpegWithExif);
  const outputMetadata = await sharp(output).metadata();

  const results = {
    detectsPng: detectImageType(png) === "png",
    detectsJpeg: detectImageType(jpeg) === "jpeg",
    detectsWebp: detectImageType(webp) === "webp",
    rejectsTextFile: detectImageType(text) === null,
    inputHadExif: inputHasExif,
    pipelineOutputsWebp: outputMetadata.format === "webp",
    pipelineStripsExif: !outputMetadata.exif,
  };

  const passed = Object.entries(results)
    .filter(([key]) => key !== "inputHadExif")
    .every(([, value]) => value === true);

  console.log(JSON.stringify({ passed, ...results }, null, 2));

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "Image verification failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
