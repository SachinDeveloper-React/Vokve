import React, { Fragment, memo } from 'react';
import { useTheme } from '../../theme';
import type { EarnRule } from '../../types/models';
import { Divider } from '../layout/Divider';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { COIN_SOURCE_STYLE } from './CoinTransactionRow';
import { EarnRuleRow } from './EarnRuleRow';

interface Props {
  /**
   * The rate card as the server serves it (RULES E14). Null before the first
   * sync, when the card says so rather than showing rates it made up — a
   * wallet that promised 300 for a referral the server pays 20 for would be
   * the kind of lie a user remembers.
   */
  rules: EarnRule[] | null;
}

/**
 * The rate card the wallet's explainer shows under the balance.
 *
 * Kept next to the ledger on purpose: the ledger says what the user earned,
 * this says how to earn more, and a user who has just seen a small balance is
 * exactly the one looking for the second answer. Each row's glyph and colour
 * come from the ledger's own per-source map, so a "Walk" rule and a steps
 * credit look like the same thing — because they are.
 */
export const EarnCoinsCard = memo(({ rules }: Props) => {
  const { colors } = useTheme();

  return (
    <Card radius="xl">
      <VStack gap="base">
        <AppText variant="label" color="textTertiary">
          Ways to earn
        </AppText>

        {rules === null ? (
          <AppText variant="caption" color="textSecondary">
            The current rates load the next time you are online.
          </AppText>
        ) : (
          rules.map((rule, index) => {
            const { icon, tint } = COIN_SOURCE_STYLE[rule.source];
            return (
              <Fragment key={`${rule.source}-${rule.title}`}>
                {index > 0 ? <Divider /> : null}
                <EarnRuleRow
                  icon={icon}
                  tint={colors[tint]}
                  title={rule.title}
                  detail={rule.detail}
                  reward={rule.reward}
                />
              </Fragment>
            );
          })
        )}
      </VStack>
    </Card>
  );
});

EarnCoinsCard.displayName = 'EarnCoinsCard';
