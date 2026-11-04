/**
 * Typography for the editable document (the form editor and the assist proposal editor). Tailwind classes on the ProseMirror root (no global CSS); table
 * classes cover Tiptap's column-resize handle and selected cells.
 */
export const FORM_CONTENT_CLASSES = [
  'min-h-48 px-4 py-3 text-sm leading-relaxed outline-none',
  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-extrabold [&_h1]:tracking-tight',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-2xl [&_h2]:font-bold',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-xl [&_h3]:font-bold',
  '[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-lg [&_h4]:font-semibold',
  '[&_h5]:mt-2 [&_h5]:font-semibold [&_h6]:mt-2 [&_h6]:font-semibold [&_h6]:text-muted-foreground',
  '[&_p]:my-2 [&_a]:text-link [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-border dark:[&_blockquote]:border-link [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-4 [&_hr]:border-border',
  '[&_.tableWrapper]:my-3 [&_.tableWrapper]:overflow-x-auto',
  '[&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse',
  '[&_td]:relative [&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top',
  '[&_th]:relative [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold',
  '[&_.selectedCell]:bg-accent',
  '[&_.column-resize-handle]:pointer-events-none [&_.column-resize-handle]:absolute [&_.column-resize-handle]:top-0 [&_.column-resize-handle]:-right-0.5 [&_.column-resize-handle]:bottom-0 [&_.column-resize-handle]:w-1 [&_.column-resize-handle]:bg-primary',
  '[&.resize-cursor]:cursor-col-resize',
  '[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
].join(' ');
