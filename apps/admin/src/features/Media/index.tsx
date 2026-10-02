import { FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMediaFolders } from '@/api/media';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { useMediaPermissions } from '@/hooks/useMediaPermissions';
import { useMediaUploader } from '@/hooks/useMediaUploader';
import { ROOT_FOLDER } from './constants';
import { Details } from './Details';
import { Dropzone } from './Dropzone';
import { FolderTree } from './FolderTree';
import { useAssetSelection } from './hooks/useAssetSelection';
import { useFolderActions } from './hooks/useFolderActions';
import { useMediaSearch } from './hooks/useMediaSearch';
import { Library } from './Library';
import { SelectionBar } from './SelectionBar';
import { Toolbar } from './Toolbar';
import { UploadButton } from './UploadButton';
import { UploadQueue } from './UploadQueue';

/** The media library: folders, search and filters, uploads (drop or pick), bulk move and asset details. Folders are created and renamed in place. */
export const Media = () => {
  const { t } = useTranslation();
  const { search, setSearch, assetQuery } = useMediaSearch();
  const folders = useMediaFolders();
  const { canWrite, canManage } = useMediaPermissions();
  const uploader = useMediaUploader();
  const selection = useAssetSelection();
  const folderActions = useFolderActions((folder) => {
    if (search.folder === folder.id) {
      setSearch({ folder: undefined });
    }
  });
  const uploadFolder = search.folder && search.folder !== ROOT_FOLDER ? search.folder : null;
  const upload = (files: File[]) => uploader.enqueue(files, { folderId: uploadFolder, visibility: 'public' });
  return (
    <Page width="full">
      <PageHeader
        title={t('media.title')}
        actions={
          canWrite ? (
            <>
              <Button variant="outline" data-new-folder onClick={() => folderActions.actions.onCreate(null)}>
                <FolderPlus aria-hidden="true" />
                {t('media.folders.new')}
              </Button>
              <UploadButton label={t('media.upload.action')} onFiles={upload} />
            </>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[13.75rem_minmax(0,1fr)]">
        <FolderTree
          folders={folders.data}
          current={search.folder}
          canWrite={canWrite}
          canManage={canManage}
          actions={folderActions.actions}
          editing={folderActions.editing}
          onEditDone={folderActions.stopEditing}
          onSelect={(folder) => {
            selection.clear();
            setSearch({ folder });
          }}
          className="lg:self-start"
        />
        <Dropzone enabled={canWrite} onFiles={upload} className="min-h-96 min-w-0 space-y-4">
          <UploadQueue onRetry={uploader.retry} onDismiss={uploader.dismiss} />
          <Toolbar
            query={search.q}
            type={search.type}
            view={search.view ?? 'grid'}
            onQueryChange={(q) => setSearch({ q }, true)}
            onTypeChange={(type) => setSearch({ type })}
            onViewChange={(view) => setSearch({ view })}
          />
          {selection.selected.size > 0 ? (
            <SelectionBar selected={selection.selected} onClear={selection.clear} />
          ) : null}
          <Library
            query={assetQuery}
            filtered={Boolean(search.q || search.type)}
            view={search.view ?? 'grid'}
            selected={selection.selected}
            selectable={canWrite}
            activeId={search.asset}
            onSelectChange={selection.toggle}
            onOpen={(asset) => setSearch({ asset: asset.id })}
          />
        </Dropzone>
      </div>
      <Details
        assetId={search.asset}
        onClose={() => setSearch({ asset: undefined })}
        onReplace={(assetId, file) =>
          uploader.enqueue([file], { folderId: null, visibility: 'public', replaceAssetId: assetId })
        }
      />
    </Page>
  );
};
