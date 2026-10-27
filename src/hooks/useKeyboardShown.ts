import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Whether the soft keyboard is up.
 *
 * iOS is asked on `will`, Android on `did`: iOS announces the keyboard before
 * it animates in, and Android has no `will` event at all. Anything watching
 * this to get out of the keyboard's way wants the earliest news each platform
 * actually has.
 */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const isIos = Platform.OS === 'ios';
    const showing = Keyboard.addListener(
      isIos ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setShown(true),
    );
    const hiding = Keyboard.addListener(
      isIos ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setShown(false),
    );
    return () => {
      showing.remove();
      hiding.remove();
    };
  }, []);

  return shown;
}
