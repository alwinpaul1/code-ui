import Svg, { Path } from 'react-native-svg'
import { brand } from '../theme/tokens'
import { APP_LOGO_PATH, APP_LOGO_VIEWBOX_HEIGHT, APP_LOGO_VIEWBOX_WIDTH } from './app-logo-path'

type Props = {
  /** Rendered height; width follows the tile's aspect ratio. */
  size?: number
  /** The tile's colour. Defaults to the brand red in both schemes: the mark is
   *  the app icon, not a surface, so it does not follow the text colour the
   *  way the old wordmark did. The knot is cut through the tile, so whatever
   *  is behind the mark shows in it and there is no second tone to override. */
  color?: string
}

/** Code UI's brand mark: a red rounded tile with two chevrons knotted into an
 *  S and cut out of it. One path, one fill; the geometry is generated into
 *  app-logo-path.ts by scripts/build-brand-assets.py, which also renders the
 *  launcher, notification and splash icons from the same shape. */
export function AppLogo({ size = 24, color = brand.red }: Props) {
  const width = size * (APP_LOGO_VIEWBOX_WIDTH / APP_LOGO_VIEWBOX_HEIGHT)
  return (
    <Svg
      width={width}
      height={size}
      viewBox={`0 0 ${APP_LOGO_VIEWBOX_WIDTH} ${APP_LOGO_VIEWBOX_HEIGHT}`}
      accessibilityLabel="Code UI"
    >
      <Path fill={color} d={APP_LOGO_PATH} />
    </Svg>
  )
}
