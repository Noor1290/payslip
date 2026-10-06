import { memo } from 'react'
import type { DrawList } from '../writers/pageGeometry'

/**
 * The on-screen payslip: the same drawing list the PDF writer uses, as SVG on a white page.
 * It is a picture of paper, so it looks the same in the dark and the light theme.
 */
export const PayslipPreview = memo(function PayslipPreview({ page, label }: { page: DrawList; label: string }) {
  return (
    <svg
      className="paper"
      viewBox={`0 0 ${page.width} ${page.height}`}
      role="img"
      aria-label={label}
      data-testid="payslip-page"
    >
      <rect x={0} y={0} width={page.width} height={page.height} fill="#ffffff" />
      {page.rects.map((rect, index) => (
        <rect key={`r${index}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={`#${rect.fill}`} />
      ))}
      {page.lines.map((line, index) => (
        <line
          key={`l${index}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={`#${line.color}`}
          strokeWidth={line.width}
          strokeLinecap="square"
        />
      ))}
      {page.texts.map((text, index) => (
        <text key={`t${index}`} x={text.x} y={text.y} fontSize={text.size} fontWeight={text.font === 'bold' ? 700 : 400}>
          {text.text}
        </text>
      ))}
    </svg>
  )
})
