'use client';

import { useEffect, useState } from 'react';
import styles from './PWAInstallPrompt.module.css';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsInstalled(true);
      return;
    }

    // Dismissed before — don't show again for 7 days
    const dismissed = localStorage.getItem('pwa_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    if (ios) {
      // Show iOS manual instructions
      setTimeout(() => setShow(true), 2000);
      return;
    }

    // Android / Chrome install prompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setTimeout(() => setShow(true), 2000);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShow(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa_dismissed', Date.now().toString());
    setShow(false);
  };

  if (isInstalled || !show) return null;

  return (
    <div className={styles.backdrop}>
      <div className={styles.sheet}>
        {/* Handle bar */}
        <div className={styles.handle} />

        {/* App info */}
        <div className={styles.appRow}>
          <div className={styles.iconWrap}>
            <img src="/logo.png" alt="Nabogaming" className={styles.icon} />
          </div>
          <div className={styles.appInfo}>
            <span className={styles.appName}>Nabogaming</span>
            <span className={styles.appSub}>Tournament Dashboard</span>
          </div>
          <div className={styles.badge}>FREE ( 186.82KB )</div>
        </div>

        {/* Features */}
        <div className={styles.features}>
          <div className={styles.feature}>
            <i className="ri-flashlight-fill" />
            <span>Instant access</span>
          </div>
          <div className={styles.feature}>
            <i className="ri-wifi-off-line" />
            <span>Works offline</span>
          </div>
          <div className={styles.feature}>
            <i className="ri-notification-3-line" />
            <span>Push notifications</span>
          </div>
        </div>

        {isIOS ? (
          <>
            <p className={styles.iosHint}>
              Install ARENA on your iPhone for the best experience:
            </p>
            <div className={styles.iosSteps}>
              <div className={styles.iosStep}>
                <span className={styles.stepNum}>1</span>
                <span>Tap the <strong>Share</strong> button <i className="ri-share-forward-line" /> in Safari</span>
              </div>
              <div className={styles.iosStep}>
                <span className={styles.stepNum}>2</span>
                <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
              </div>
              <div className={styles.iosStep}>
                <span className={styles.stepNum}>3</span>
                <span>Tap <strong>"Add"</strong> to confirm</span>
              </div>
            </div>
            <button className={styles.dismissBtn} onClick={handleDismiss}>
              Maybe later
            </button>
          </>
        ) : (
          <div className={styles.actions}>
            <button className={styles.dismissBtn} onClick={handleDismiss}>
              Not now
            </button>
            <button className={styles.installBtn} onClick={handleInstall}>
              <i className="ri-download-2-line" />
              Install App
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
