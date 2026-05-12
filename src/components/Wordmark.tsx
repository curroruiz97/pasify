interface WordmarkProps {
  /** Altezza in px. Se non passata, usa className per controllare l'altezza. */
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Wordmark ufficiale Pasify. Carica /pasify-logo.png — single source of truth.
 * Sostituisce il vecchio markup inline `<span>Pas</span><dot><span>if</span>...`.
 */
export const Wordmark = ({ height, className, style }: WordmarkProps) => (
  <img
    src="/pasify-logo.png"
    alt="Pasify"
    className={className}
    style={{
      width: "auto",
      display: "block",
      border: 0,
      outline: 0,
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitUserDrag: "none" as unknown as string,
      ...(height !== undefined ? { height } : {}),
      ...style,
    }}
    draggable={false}
    decoding="async"
  />
);

export default Wordmark;
