/**
 * The layouts the plugin hands the Stream Deck software, by path inside
 * the plugin folder. A leaf on purpose: a test that reads a layout file
 * wants the path without the action graph behind `base.ts`.
 */

/**
 * The layout a Neo's infobar is given, shared by every action: the face's
 * `when` as a label along the top, its title as the reading beneath, and a
 * bar underneath for a running timer's fraction.
 *
 * Shipped from Stream Deck SDK 3.0.0 on; an action lists `Neo` among its
 * controllers to be offered for the bar, and that needs Stream Deck 7.6 as
 * the plugin's minimum, so no action lists it until 7.6 is out.
 */
export const NEO_LAYOUT = "layouts/neo-face.json";
