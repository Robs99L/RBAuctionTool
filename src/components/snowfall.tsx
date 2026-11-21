import styles from "./snowfall.module.css";

export function Snowfall({ variant = "presentation" }: { variant?: "presentation" | "participant" }) {
  return (
    <div className={`${styles.layer}${variant === "participant" ? ` ${styles.participant}` : ""}`} aria-hidden="true">
      {Array.from({ length: 144 }, (_, index) => (
        <span
          key={index}
          className={styles.flake}
          style={{
            left: `${(index * 37 + 11) % 100}%`,
            width: `${4 + (index % 6)}px`,
            height: `${4 + (index % 6)}px`,
            opacity: 0.65 + (index % 4) * 0.1,
            animationDuration: `${10 + (index % 6) * 2}s`,
            animationDelay: `${-((index * 7.3) % 20)}s`,
          }}
        />
      ))}
    </div>
  );
}
