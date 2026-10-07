import type { Extension } from '@codemirror/state';
import type { CodeLanguage } from '@shapio/schema';
import { useEffect, useState } from 'react';
import { languageExtension } from '@/components/CodeMirror/helpers/languages';
import { reportError } from '@/helpers/reportError';

const NONE: Extension = [];

/**
 * The language support for a code field, loaded on demand. Until its pack arrives (and if it fails to load)
 * the editor shows plain text; the editor reconfigures when it lands.
 */
export const useLanguageExtension = (language: CodeLanguage): Extension => {
  const [loaded, setLoaded] = useState<{ language: CodeLanguage; extension: Extension }>();
  useEffect(() => {
    let current = true;
    languageExtension(language).then(
      (extension) => {
        if (current) {
          setLoaded({ language, extension });
        }
      },
      (error: unknown) => reportError(error, `Loading ${language} highlighting`),
    );
    return () => {
      current = false;
    };
  }, [language]);
  return loaded?.language === language ? loaded.extension : NONE;
};
