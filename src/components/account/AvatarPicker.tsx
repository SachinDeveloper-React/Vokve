import React, { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Camera, ImagePlus, Trash2 } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import {
  pickFromLibrary,
  takePhoto,
  type PickResult,
} from '../../services/imagePicker';
import { toApiError } from '../../services/api/errors';
import { useAuthStore } from '../../stores/authStore';
import { ActionSheet } from '../disclosure/ActionSheet';
import { useToast } from '../feedback/Toast';
import { Pressable } from '../form/Pressable';
import { Avatar, type AvatarSize } from '../media/Avatar';

interface Props {
  /** Drawn as initials until there is a photo. */
  name: string;
  /** The photo the account currently has, or null. */
  uri?: string | null;
  size?: AvatarSize;
  /** A ring around the disc — `true` for the brand accent, or a colour. */
  ring?: boolean | string;
  /** Called with the URL the server settled on, or null after a removal. */
  onChange?: (avatarUrl: string | null) => void;
}

/**
 * The profile photo, and the three things a member can do to it.
 *
 * Tapping opens a sheet rather than the camera: "change my photo" is two
 * intentions — take one, or pick one — and a control that guessed would be
 * wrong half the time. "Remove" only appears once there is something to
 * remove.
 *
 * The photo is uploaded the moment it is chosen rather than being held for
 * the form's Save. It is the one field on these screens that is not text:
 * there is nothing to validate against the rest of the form, and a member
 * who picks a photo and then backs out of the form would otherwise be
 * surprised to find it gone. The upload downscales on the phone first
 * (`AVATAR_MAX_EDGE`), so what travels is tens of kilobytes.
 */
export const AvatarPicker = memo(
  ({ name, uri, size = 'lg', ring = true, onChange }: Props) => {
    const { colors } = useTheme();
    const toast = useToast();
    const setAvatar = useAuthStore(s => s.setAvatar);
    const isSaving = useAuthStore(s => s.isSavingAvatar);
    const [isOpen, setOpen] = useState(false);

    const close = useCallback(() => setOpen(false), []);

    /** One place to send a chosen photo, and one place to word what came back. */
    const upload = useCallback(
      async (result: PickResult) => {
        if (result.status === 'cancelled') {
          return;
        }
        if (result.status === 'denied') {
          toast.show({
            title: 'Permission needed',
            message:
              'Allow VOKVE to use your camera or photos in Settings, then try again.',
            tone: 'warning',
          });
          return;
        }
        if (result.status === 'failed') {
          toast.show({
            title: "Couldn't use that photo",
            message: result.message,
            tone: 'warning',
          });
          return;
        }
        try {
          // Only the bytes and the type travel: the local `uri` is for
          // showing the choice, and the API's body is strict about extras.
          const { data, contentType } = result.image;
          const user = await setAvatar({ data, contentType });
          onChange?.(user.avatarUrl);
          toast.show({
            title: 'Photo updated',
            tone: 'success',
            durationMs: 1800,
          });
        } catch (error) {
          const apiError = toApiError(error);
          toast.show({
            title:
              apiError.code === 'AVATAR_TOO_LARGE'
                ? 'That photo is too large'
                : "Couldn't save your photo",
            message: apiError.message,
            tone: 'error',
          });
        }
      },
      [onChange, setAvatar, toast],
    );

    const onRemove = useCallback(async () => {
      try {
        const user = await setAvatar(null);
        onChange?.(user.avatarUrl);
        toast.show({ title: 'Photo removed', tone: 'info', durationMs: 1800 });
      } catch (error) {
        toast.show({
          title: "Couldn't remove your photo",
          message: toApiError(error).message,
          tone: 'error',
        });
      }
    }, [onChange, setAvatar, toast]);

    const actions = useMemo(() => {
      const base = [
        {
          label: 'Take a photo',
          icon: Camera,
          onPress: () => takePhoto().then(upload),
        },
        {
          label: 'Choose from library',
          icon: ImagePlus,
          onPress: () => pickFromLibrary().then(upload),
        },
      ];
      return uri
        ? [
            ...base,
            {
              label: 'Remove photo',
              icon: Trash2,
              destructive: true,
              onPress: onRemove,
            },
          ]
        : base;
    }, [onRemove, upload, uri]);

    return (
      <>
        <Pressable
          onPress={() => setOpen(true)}
          feedback="scale"
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityLabel={
            uri ? 'Change your profile photo' : 'Add a profile photo'
          }
          accessibilityState={{ busy: isSaving }}
        >
          <View>
            <Avatar name={name} uri={uri} size={size} ring={ring} />

            {isSaving ? (
              <View
                style={[styles.veil, { backgroundColor: colors.overlayMedium }]}
              >
                <ActivityIndicator color={colors.primaryForeground} />
              </View>
            ) : (
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.background,
                  },
                ]}
              >
                <Camera
                  size={moderateScale(13)}
                  color={colors.primaryForeground}
                  strokeWidth={2.4}
                />
              </View>
            )}
          </View>
        </Pressable>

        <ActionSheet
          visible={isOpen}
          onClose={close}
          title="Profile photo"
          message="Shown on your profile and on the reviews you write."
          actions={actions}
        />
      </>
    );
  },
);

AvatarPicker.displayName = 'AvatarPicker';

const styles = StyleSheet.create({
  /** Covers the disc while the upload is in flight, so the tap reads as taken. */
  veil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: moderateScale(24),
    height: moderateScale(24),
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
