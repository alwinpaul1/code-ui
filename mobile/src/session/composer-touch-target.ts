/** The composer's round buttons are 36 dp across and 48 dp to touch, as the Claude app's are
 *  (1.261009.20: `yg9` sizes a button `ixv.p(36)` and gives it `ixv.k(48)` of touch). A
 *  `hitSlop` of 6 on every side takes 36 to 48 without moving a pixel of layout. Neighbours sit
 *  8 dp apart, so their slops share 4 dp of the gap, and React Native tests children last to
 *  first (Android's `TouchTargetHelper`): the later, right-hand button takes those 4 dp. The slop
 *  is smaller than the gap, so it never reaches inside a neighbour's 36 dp body. Not measured on
 *  a device. */
export const COMPOSER_BUTTON_SIZE = 36
export const COMPOSER_TOUCH_TARGET = 48
export const COMPOSER_BUTTON_HIT_SLOP = (COMPOSER_TOUCH_TARGET - COMPOSER_BUTTON_SIZE) / 2
