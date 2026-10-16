import Image from "next/image";

import rbLogo from "../../RB Logo.png";

export function RbLogo() {
  return (
    <span className="relative block h-12 w-[7.5rem] shrink-0 overflow-hidden" aria-hidden="true">
      <Image
        src={rbLogo}
        alt=""
        fill
        sizes="120px"
        className="scale-[2.15] object-contain"
      />
    </span>
  );
}
