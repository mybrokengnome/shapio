import { SaveActions, type SaveActionsProps } from '../SaveActions';

/** Below xl the save actions stay in reach at the bottom of the screen (above the status bar on md+). */
export const ActionFooter = (props: SaveActionsProps) => (
  <div className="sticky bottom-0 z-20 -mx-4 flex justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-8 sm:px-8 md:bottom-(--statusbar-h) xl:hidden">
    <SaveActions {...props} />
  </div>
);
