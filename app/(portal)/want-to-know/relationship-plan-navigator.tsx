import Link from "next/link";
import styles from "./want-to-know-controls.module.css";

export type RelationshipPlanNavigationItem = {
  count: number;
  goal: string;
  href: string;
  id: string;
  label: string;
  signal: string;
};

function DirectionGlyph() {
  return (
    <svg aria-hidden="true" className={styles.directionGlyph} viewBox="0 0 18 18">
      <path d="m6.75 3.75 5.25 5.25-5.25 5.25" />
    </svg>
  );
}
/** A real navigation register, replacing the former inert category rows. */
export function RelationshipPlanNavigator({
  activeId,
  items,
  label = "Relationship plans",
}: {
  activeId: string;
  items: RelationshipPlanNavigationItem[];
  label?: string;
}) {
  return (
    <nav aria-label={label} className={styles.planNavigator}>
      <ul className={styles.planList}>
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li className={styles.planItem} key={item.id}>
              <Link
                aria-current={active ? "page" : undefined}
                className={styles.planLink}
                data-active={active ? "true" : "false"}
                href={item.href}
              >
                <span className={styles.planIdentity}>
                  <strong>{item.label}</strong>
                  <span>{item.goal}</span>
                </span>
                <span className={styles.planSignal}>{item.signal}</span>
                <span className={styles.planCount}>
                  <b>{item.count}</b>
                  <span>{item.count === 1 ? "person" : "people"}</span>
                </span>
                <DirectionGlyph />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
