import React, { memo } from 'react';
import { StyleSheet, View, ViewProps, ViewStyle } from 'react-native';

type Anchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

interface Props extends ViewProps {
  children: React.ReactNode;
  /** Where the overlaid children sit within the stack. */
  anchor?: Anchor;
}

const ANCHORS: Record<Anchor, ViewStyle> = {
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { alignItems: 'center', justifyContent: 'flex-start' },
  bottom: { alignItems: 'center', justifyContent: 'flex-end' },
  left: { alignItems: 'flex-start', justifyContent: 'center' },
  right: { alignItems: 'flex-end', justifyContent: 'center' },
  topLeft: { alignItems: 'flex-start', justifyContent: 'flex-start' },
  topRight: { alignItems: 'flex-end', justifyContent: 'flex-start' },
  bottomLeft: { alignItems: 'flex-start', justifyContent: 'flex-end' },
  bottomRight: { alignItems: 'flex-end', justifyContent: 'flex-end' },
};

/**
 * Layers children on top of each other, in source order — a gradient under a
 * label, a badge over an avatar, a scrim over an image.
 *
 * The first child is laid out normally and defines the stack's size; every
 * later child is positioned absolutely over it. That way the stack cannot
 * collapse to zero height, which is what happens when every layer is absolute.
 */
export const ZStack = memo(
  ({ children, anchor = 'center', style, ...rest }: Props) => {
    const items = React.Children.toArray(children);
    const [base, ...overlays] = items;

    return (
      <View style={[styles.container, ANCHORS[anchor], style]} {...rest}>
        {base}
        {overlays.map((child, index) => (
          <View
            key={index}
            style={[styles.overlay, ANCHORS[anchor]]}
            pointerEvents="box-none"
          >
            {child}
          </View>
        ))}
      </View>
    );
  },
);

ZStack.displayName = 'ZStack';

const styles = StyleSheet.create({
  container: { position: 'relative' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
