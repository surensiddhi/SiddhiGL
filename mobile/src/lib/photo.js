// SiddhiGL Mobile — shrink a camera photo before saving it.
// A 4000px phone photo (3-5 MB) becomes about 1280px and 150-300 KB:
// still readable for a bill, and cheap on mobile data.

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function compress(file, maxSide = 1280, quality = 0.72) {
  let src, w, h;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; h = src.height;
  } catch {
    src = await loadImage(file);
    w = src.naturalWidth; h = src.naturalHeight;
  }

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';                     // PNG with transparency -> white, not black
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();

  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read the photo'))), 'image/jpeg', quality));
}
