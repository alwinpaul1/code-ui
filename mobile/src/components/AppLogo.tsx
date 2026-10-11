import Svg, { Path } from 'react-native-svg'
import { useTheme } from '../theme/theme-context'
import { brand } from '../theme/tokens'
import { APP_LOGO_PATH, APP_LOGO_VIEWBOX_HEIGHT, APP_LOGO_VIEWBOX_WIDTH } from './app-logo-path'

type Props = {
  /** Rendered height; width follows the tile's aspect ratio. */
  size?: number
  /** The tile's colour. Defaults to black in light mode and white in dark
   *  mode, after the launcher icon (2026-10-11). The knot is cut through the
   *  tile, so whatever is behind the mark shows in it and there is no second
   *  tone to override. */
  color?: string
}

/** Code UI's brand mark: a rounded tile with two chevrons knotted into an
 *  S and cut out of it. One path, one fill; the geometry is generated into
 *  app-logo-path.ts by scripts/build-brand-assets.py, which also renders the
 *  launcher, notification and splash icons from the same shape. */
export function AppLogo({ size = 24, color }: Props) {
  const { isDark } = useTheme()
  const fill = color ?? (isDark ? brand.markDark : brand.markLight)
  const width = size * (APP_LOGO_VIEWBOX_WIDTH / APP_LOGO_VIEWBOX_HEIGHT)
  return (
    <Svg
      width={width}
      height={size}
      viewBox={`0 0 ${APP_LOGO_VIEWBOX_WIDTH} ${APP_LOGO_VIEWBOX_HEIGHT}`}
      accessibilityLabel="Code UI"
    >
      <Path fill={fill} d={APP_LOGO_PATH} />
    </Svg>
  )
}
