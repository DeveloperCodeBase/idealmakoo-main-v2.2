'use client';

import {useApp} from '@/components/providers/AppProvider';
import {accountText} from './account-copy';
import styles from './account.module.css';

/** The account frame stays mounted while its selected body or data loads. */
export function AccountBodyLoading() {
  const {locale, t} = useApp();
  return <div className={styles.panel} data-account-body-state="loading" aria-busy="true">
    <div className="site-loading" role="status"><span className="loading-orbit" aria-hidden="true"/><p>{accountText(locale, 'working', t)}</p></div>
  </div>;
}

export function AccountRequestError({error, onRetry}: {error: string; onRetry: () => void}) {
  const {locale} = useApp();
  const retry = {fa: 'تلاش دوباره', en: 'Try again', tr: 'Yeniden dene', ar: 'المحاولة مجددًا', ru: 'Повторить'};
  return <div className={styles.panel} data-account-body-state="error">
    <p role="alert">{error}</p><button type="button" className={styles.secondaryButton} onClick={onRetry}>{retry[locale]}</button>
  </div>;
}
