import { useState, useEffect, useRef } from 'react';
import styles from './LocationOnboarding.module.css';

type Step = 'checking' | 'welcome' | 'requesting' | 'denied';
type InitialPermission = 'prompt' | 'denied' | 'unsupported';

interface Props {
  onGranted: () => void;
}

function ListMockup() {
  return (
    <svg viewBox="0 0 130 180" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.mockupSvg}>
      <rect width="130" height="180" rx="10" fill="#f9fafb"/>
      <rect x="10" y="12" width="65" height="7" rx="3" fill="#111827"/>
      <rect x="10" y="23" width="45" height="5" rx="2" fill="#d1d5db"/>
      <line x1="10" y1="36" x2="120" y2="36" stroke="#e5e7eb" strokeWidth="1"/>
      {/* Card 1 */}
      <rect x="10" y="42" width="110" height="38" rx="8" fill="white" stroke="#e5e7eb" strokeWidth="1"/>
      <rect x="18" y="50" width="20" height="20" rx="4" fill="#2563eb"/>
      <text x="28" y="64" fill="white" fontSize="11" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">I</text>
      <rect x="46" y="52" width="42" height="5" rx="2" fill="#374151"/>
      <rect x="46" y="61" width="28" height="4" rx="2" fill="#9ca3af"/>
      <rect x="92" y="52" width="20" height="8" rx="3" fill="#dcfce7"/>
      <rect x="94" y="55" width="16" height="3" rx="1" fill="#16a34a"/>
      {/* Card 2 */}
      <rect x="10" y="86" width="110" height="38" rx="8" fill="white" stroke="#e5e7eb" strokeWidth="1"/>
      <rect x="18" y="94" width="20" height="20" rx="4" fill="#f97316"/>
      <text x="28" y="108" fill="white" fontSize="11" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">F</text>
      <rect x="46" y="96" width="38" height="5" rx="2" fill="#374151"/>
      <rect x="46" y="105" width="28" height="4" rx="2" fill="#9ca3af"/>
      <rect x="92" y="96" width="20" height="8" rx="3" fill="#dcfce7"/>
      <rect x="94" y="99" width="16" height="3" rx="1" fill="#16a34a"/>
      {/* Card 3 */}
      <rect x="10" y="130" width="110" height="38" rx="8" fill="white" stroke="#e5e7eb" strokeWidth="1"/>
      <rect x="18" y="138" width="20" height="20" rx="4" fill="#e5e7eb"/>
      <rect x="46" y="140" width="50" height="5" rx="2" fill="#374151"/>
      <rect x="46" y="149" width="32" height="4" rx="2" fill="#9ca3af"/>
      <rect x="92" y="140" width="20" height="8" rx="3" fill="#fef3c7"/>
      <rect x="94" y="143" width="16" height="3" rx="1" fill="#d97706"/>
    </svg>
  );
}

function MapMockup() {
  return (
    <svg viewBox="0 0 130 180" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.mockupSvg}>
      <rect width="130" height="180" rx="10" fill="#e8f4f8"/>
      {/* Road grid */}
      <line x1="0" y1="108" x2="130" y2="108" stroke="#cfe8f0" strokeWidth="7"/>
      <line x1="62" y1="0" x2="62" y2="180" stroke="#cfe8f0" strokeWidth="5"/>
      <line x1="0" y1="48" x2="130" y2="68" stroke="#cfe8f0" strokeWidth="3"/>
      {/* Route polyline */}
      <path
        d="M 18 162 C 30 148 40 132 50 114 C 60 96 68 80 80 60 C 88 46 98 32 114 16"
        stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
      />
      {/* Origin dot */}
      <circle cx="18" cy="162" r="7" fill="#1d4ed8" stroke="white" strokeWidth="2.5"/>
      {/* Station pins */}
      <circle cx="48" cy="116" r="6" fill="#2563eb" stroke="white" strokeWidth="2"/>
      <circle cx="76" cy="64" r="6" fill="#2563eb" stroke="white" strokeWidth="2"/>
      <circle cx="112" cy="18" r="6" fill="#2563eb" stroke="white" strokeWidth="2"/>
    </svg>
  );
}

export function LocationOnboarding({ onGranted }: Props) {
  const [step, setStep] = useState<Step>('checking');
  const [initialPermission, setInitialPermission] = useState<InitialPermission>('prompt');
  const onGrantedRef = useRef(onGranted);
  useEffect(() => { onGrantedRef.current = onGranted; }, [onGranted]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setInitialPermission('unsupported');
      setStep('denied');
      return;
    }
    if (!navigator.permissions) {
      // Permissions API unavailable — show welcome, assume first-time prompt
      setStep('welcome');
      return;
    }
    navigator.permissions.query({ name: 'geolocation' }).then(result => {
      if (result.state === 'granted') {
        onGrantedRef.current();
        return;
      }
      setInitialPermission(result.state as InitialPermission);
      setStep('welcome');
      result.addEventListener('change', () => {
        if (result.state === 'granted') onGrantedRef.current();
      });
    });
  }, []);

  function handleAllow() {
    setStep('requesting');
    navigator.geolocation.getCurrentPosition(
      () => onGrantedRef.current(),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStep('denied');
        } else {
          // Timeout or position unavailable — permission was granted, just no fix yet
          onGrantedRef.current();
        }
      },
      { timeout: 15_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>

        {step === 'checking' && (
          <div className={styles.centered}>
            <div className={styles.spinner} />
          </div>
        )}

        {step === 'welcome' && (
          <>
            <div className={styles.brand}>
              <h1 className={styles.title}>let's just drive</h1>
              <p className={styles.subtitle}>quality charging ON your route</p>
            </div>

            <div className={styles.mockups}>
              <figure className={styles.mockupFigure}>
                <ListMockup />
                <figcaption className={styles.mockupCaption}>Stations on your route</figcaption>
              </figure>
              <figure className={styles.mockupFigure}>
                <MapMockup />
                <figcaption className={styles.mockupCaption}>Route overview</figcaption>
              </figure>
            </div>

            <p className={styles.description}>
              Enter your destination and see the best DC fast chargers along the way — your route is never changed.
            </p>

            <div className={styles.locationReason}>
              <span className={styles.locationIcon}>📍</span>
              <p>
                {initialPermission === 'denied'
                  ? 'Location access was previously denied. Enable it in your browser settings and tap Try again.'
                  : 'We need your location to know your starting point and calculate distances to chargers.'}
              </p>
            </div>

            <button className={styles.primaryBtn} onClick={handleAllow}>
              {initialPermission === 'denied' ? 'Try again' : 'Allow location access'}
            </button>
          </>
        )}

        {step === 'requesting' && (
          <div className={styles.centered}>
            <div className={styles.spinner} />
            <p className={styles.requestingText}>
              Please accept the location prompt in your browser.
            </p>
          </div>
        )}

        {step === 'denied' && (
          <>
            <div className={styles.brand}>
              <h1 className={styles.titleSmall}>Location access needed</h1>
            </div>
            <div className={styles.deniedBlock}>
              <span className={styles.deniedIcon}>🔒</span>
              <div>
                <p>
                  {initialPermission === 'unsupported'
                    ? "Your browser doesn't support location services. Try a different browser."
                    : "This app can't work without your location — we use it to find charging stations near your starting point."}
                </p>
                {initialPermission !== 'unsupported' && (
                  <p className={styles.deniedHint}>
                    Enable location access in your browser settings, then tap Try again.
                  </p>
                )}
              </div>
            </div>
            {initialPermission !== 'unsupported' && (
              <button className={styles.secondaryBtn} onClick={handleAllow}>
                Try again
              </button>
            )}
          </>
        )}

      </div>
    </div>
  );
}
