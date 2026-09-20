import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  onPress: () => void;
  placeholder?: string;
}

/**
 * The shop's search field — as a button that opens the search screen, not a
 * live field. Typing on the shop itself would push the shelf about under
 * the keyboard; the search screen has the room, the recent searches and
 * the results list, and one tap gets there with the keyboard already up.
 */
export const ShopSearchBar = memo(
  ({ onPress, placeholder = 'Search tees, mats, rackets…' }: Props) => {
    const { colors } = useTheme();

    return (
      <Pressable
        onPress={onPress}
        feedback="opacity"
        accessibilityRole="search"
        accessibilityLabel="Search the shop"
      >
        <HStack
          align="center"
          gap="sm"
          px="md"
          style={[
            styles.field,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Icon as={Search} size="md" color="textTertiary" />
          <AppText variant="body" color="textTertiary" numberOfLines={1}>
            {placeholder}
          </AppText>
        </HStack>
      </Pressable>
    );
  },
);

ShopSearchBar.displayName = 'ShopSearchBar';

const styles = StyleSheet.create({
  field: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
