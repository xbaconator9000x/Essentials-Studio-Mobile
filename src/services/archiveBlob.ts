export function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  if (typeof FileReader === "undefined") {
    return Promise.reject(new Error("This browser cannot read project ZIP data"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read project ZIP data"));
    reader.onabort = () => reject(new Error("Reading project ZIP data was cancelled"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read project ZIP data"));
      }
    };
    reader.readAsArrayBuffer(blob);
  });
}
