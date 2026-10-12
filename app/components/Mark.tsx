import { IconCheck, IconCross } from "./icons";

/** 通过 / 未过，线框 SVG，不用文字勾叉。 */
export default function Mark({ ok, size = 12 }: { ok: boolean; size?: number }) {
  return ok ? <IconCheck size={size} /> : <IconCross size={size} />;
}
