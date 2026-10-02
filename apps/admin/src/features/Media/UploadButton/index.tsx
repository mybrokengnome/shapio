import { Upload } from 'lucide-react';
import { useRef, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

type UploadButtonProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  label: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
};

/** A button that opens the file picker (the keyboard path; dropping files is the pointer shortcut). */
export const UploadButton = ({ label, multiple = true, onFiles, ...buttonProps }: UploadButtonProps) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button {...buttonProps} onClick={() => input.current?.click()}>
        <Upload aria-hidden="true" />
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        multiple={multiple}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) {
            onFiles(files);
          }
        }}
      />
    </>
  );
};
