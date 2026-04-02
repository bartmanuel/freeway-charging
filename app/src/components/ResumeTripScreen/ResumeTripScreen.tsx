import styles from './ResumeTripScreen.module.css';

interface Props {
  destinationName: string;
  onYes: () => void;
  onNo: () => void;
}

export function ResumeTripScreen({ destinationName, onYes, onNo }: Props) {
  return (
    <div className={styles.screen}>
      <img
        src="/icons/location_marker_ccs2_inverted.svg"
        className={styles.appIcon}
        alt="LetsJustDrive"
      />
      <div className={styles.card}>
        <p className={styles.question}>
          Still driving to{' '}
          <span className={styles.destination}>{destinationName}</span>?
        </p>
        <div className={styles.actions}>
          <button className={styles.yesButton} onClick={onYes}>
            Yes, let's just drive
          </button>
          <button className={styles.noButton} onClick={onNo}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}
