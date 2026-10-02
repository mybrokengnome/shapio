/** The storage (bucket or Shapio's upload route) refused the bytes; `status` 0 means the request never completed. */
export class UploadTransferError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Upload failed with status ${status}`);
    this.name = 'UploadTransferError';
    this.status = status;
    this.body = body;
  }
}

type UploadWithProgressInput = {
  url: string;
  form: FormData;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
};

/**
 * POSTs a multipart form with upload progress (fetch cannot report it, so this uses XMLHttpRequest).
 * No credentials are sent: the grant's fields authorise the upload, whether it goes to a bucket or to Shapio.
 */
export const uploadWithProgress = ({ url, form, onProgress, signal }: UploadWithProgressInput) =>
  new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.withCredentials = false;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      reject(new UploadTransferError(request.status, request.responseText));
    };
    request.onerror = () => reject(new UploadTransferError(0, ''));
    request.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(form);
  });
