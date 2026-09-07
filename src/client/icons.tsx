/**
 * 统一 SVG 图标集（16px stroke 线形，currentColor）。
 * 取代旧界面的 emoji/文本符号（📚 ⚙ × ▲▼ 等）。
 */
import { createElement as h } from 'react'
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
}

export const IconSearch = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)

export const IconClose = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M6 6l12 12M18 6 6 18" /></svg>
)

export const IconChevronDown = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="m6 9 6 6 6-6" /></svg>
)

export const IconChevronRight = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="m9 6 6 6-6 6" /></svg>
)

export const IconGear = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
  </svg>
)

export const IconTrash = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
)

export const IconBook = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></svg>
)

export const IconFolder = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M4 5a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z" /></svg>
)

export const IconFile = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v5h5" /></svg>
)

export const IconExpand = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
)

export const IconCompress = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" /></svg>
)

export const IconGraph = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="9" cy="18" r="2.5" /><path d="m8 7.4 8.2 1.2M7.6 8l1.8 8M15.8 9.6 10.2 16.4" /></svg>
)

export const IconRefresh = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
)

export const IconImport = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
)

export const IconSparkles = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg>
)

export const IconCopy = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
)

export const IconCheck = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="m4 12.5 5 5L20 6.5" /></svg>
)

export const IconBack = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M19 12H5m0 0 6-6m-6 6 6 6" /></svg>
)

export const IconWarning = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17.5v.01" /></svg>
)

export const IconInfo = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>
)

export const IconPlus = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M12 5v14M5 12h14" /></svg>
)

export const IconLayers = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
)

export const IconLink = ({ size = 16, ...rest }: IconProps) => (
  <svg {...base(size)} {...rest}><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></svg>
)
