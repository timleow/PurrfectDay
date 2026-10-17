async function convertHeicPhoto(file: File) {
  const { convertHeic } = await import("@keeratita/heic-converter");
  return convertHeic(file, {
    to: "jpeg",
    quality: 0.82,
    maxWidth: 512,
    maxHeight: 512,
  });
}

async function loadBrowserImage(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the image element decoder for browsers with partial bitmap support.
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not decode ${file.name} (${file.type || "unknown image type"}).`));
    };
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = objectUrl;
  });
}

async function convertBrowserImage(file: File): Promise<Blob> {
  let source: Awaited<ReturnType<typeof loadBrowserImage>>;
  try {
    source = await loadBrowserImage(file);
  } catch (cause) {
    if (cause instanceof Error && cause.message) throw cause;
    throw new Error(`Could not decode this ${file.type || "image"} file.`);
  }
  try {
    const scale = Math.min(1, 512 / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not process this photo.");
    context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not process this photo.")), "image/jpeg", 0.82);
    });
  } finally {
    source.close?.();
  }
}

export async function compressCatPhoto(file: File): Promise<Blob> {
  const isHeicByNameOrType = /\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type);
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const signature = String.fromCharCode(...header);
  const hasHeifSignature = signature.includes("ftyp") && /heic|heix|hevc|hevx|mif1|msf1|heis|heim|hevm|hevs/.test(signature);
  const isHeic = isHeicByNameOrType || hasHeifSignature;
  return isHeic ? convertHeicPhoto(file) : convertBrowserImage(file);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not prepare this photo."));
    reader.readAsDataURL(blob);
  });
}

export function cropCatPhoto(dataUrl: string, position: { x: number; y: number; zoom?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("Could not prepare the cat photo crop."));
    image.onload = () => {
      const side = Math.min(image.naturalWidth, image.naturalHeight) / Math.min(3, Math.max(1, position.zoom ?? 1));
      const maxX = image.naturalWidth - side;
      const maxY = image.naturalHeight - side;
      const sourceX = maxX * Math.min(100, Math.max(0, position.x)) / 100;
      const sourceY = maxY * Math.min(100, Math.max(0, position.y)) / 100;
      const outputSize = Math.min(side, 512);
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not prepare the cat photo crop."));
        return;
      }
      context.drawImage(image, sourceX, sourceY, side, side, 0, 0, outputSize, outputSize);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    image.src = dataUrl;
  });
}
