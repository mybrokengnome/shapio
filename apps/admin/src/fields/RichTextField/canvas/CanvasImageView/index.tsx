import type { ReactNodeViewProps } from '@tiptap/react';
import { ImageView } from '../../ImageView';

/** The image node view in the canvas: caption and quiet chrome (see `ImageView`). */
export const CanvasImageView = (props: ReactNodeViewProps) => <ImageView {...props} appearance="canvas" />;
