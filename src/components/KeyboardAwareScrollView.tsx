import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
  type ScrollViewProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { getKeyboardScrollTarget } from '../utils/keyboardScroll';

type KeyboardAwareScrollViewProps = ScrollViewProps & {
  keyboardAvoidingViewStyle?: ViewStyle;
  keyboardVerticalOffset?: number;
};

type KeyboardScrollContextValue = {
  registerFocusedInput: (input: TextInput | null) => void;
  scrollFocusedInputIntoView: () => void;
};

const KeyboardScrollContext = createContext<KeyboardScrollContextValue | null>(null);

export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  keyboardAvoidingViewStyle,
  keyboardVerticalOffset = 0,
  onScroll,
  ...scrollProps
}: KeyboardAwareScrollViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const viewportRef = useRef<View>(null);
  const focusedInputRef = useRef<TextInput | null>(null);
  const scrollOffsetRef = useRef(0);
  const keyboardStartOffsetRef = useRef<number | undefined>(undefined);
  const keyboardTopRef = useRef<number | undefined>(undefined);
  const scrollFocusedInputIntoView = useCallback(() => {
    if (keyboardTopRef.current === undefined) {
      return;
    }
    const input = focusedInputRef.current;
    const scrollView = scrollRef.current;
    const viewport = viewportRef.current;
    if (!input || !scrollView || !viewport) {
      return;
    }
    requestAnimationFrame(() => {
      input.measureInWindow((_inputX, inputTop, _inputWidth, inputHeight) => {
        viewport.measureInWindow((_scrollX, viewportTop, _scrollWidth, viewportHeight) => {
          const target = getKeyboardScrollTarget({
            inputTop,
            inputHeight,
            viewportTop,
            viewportHeight,
            keyboardTop: keyboardTopRef.current,
            currentScrollOffset: scrollOffsetRef.current,
          });
          if (target > scrollOffsetRef.current) {
            scrollOffsetRef.current = target;
            scrollRef.current?.scrollTo({ y: target, animated: true });
          }
        });
      });
    });
  }, []);
  const registerFocusedInput = useCallback((input: TextInput | null) => {
    focusedInputRef.current = input;
    if (keyboardStartOffsetRef.current === undefined) {
      keyboardStartOffsetRef.current = scrollOffsetRef.current;
    }
    if (keyboardTopRef.current !== undefined) {
      scrollFocusedInputIntoView();
    }
  }, [scrollFocusedInputIntoView]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      if (keyboardStartOffsetRef.current === undefined) {
        keyboardStartOffsetRef.current = scrollOffsetRef.current;
      }
      keyboardTopRef.current = event.endCoordinates.screenY;
      scrollFocusedInputIntoView();
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopRef.current = undefined;
      const restoreOffset = keyboardStartOffsetRef.current;
      keyboardStartOffsetRef.current = undefined;
      if (restoreOffset !== undefined) {
        scrollOffsetRef.current = restoreOffset;
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ y: restoreOffset, animated: true });
        });
      }
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [scrollFocusedInputIntoView]);

  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, keyboardAvoidingViewStyle]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      <KeyboardScrollContext.Provider value={{ registerFocusedInput, scrollFocusedInputIntoView }}>
        <View ref={viewportRef} style={{ flex: 1 }}>
          <ScrollView
            {...scrollProps}
            ref={scrollRef}
            style={[{ flex: 1 }, scrollProps.style]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={false}
            scrollEventThrottle={16}
            onScroll={(event) => {
              scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
              onScroll?.(event);
            }}
          >
            <View style={[{ flexGrow: 1 }, contentContainerStyle]}>
              {children}
            </View>
          </ScrollView>
        </View>
      </KeyboardScrollContext.Provider>
    </KeyboardAvoidingView>
  );
}

export const KeyboardAwareTextInput = forwardRef<TextInput, TextInputProps>(
  function KeyboardAwareTextInput({ onFocus, onContentSizeChange, ...props }, forwardedRef) {
    const context = useContext(KeyboardScrollContext);
    const inputRef = useRef<TextInput>(null);
    const setRef = useCallback((instance: TextInput | null) => {
      inputRef.current = instance;
      if (typeof forwardedRef === 'function') {
        forwardedRef(instance);
      } else if (forwardedRef) {
        forwardedRef.current = instance;
      }
    }, [forwardedRef]);

    return (
      <TextInput
        {...props}
        ref={setRef}
        onFocus={(event) => {
          onFocus?.(event);
          context?.registerFocusedInput(inputRef.current);
        }}
        onContentSizeChange={(event) => {
          onContentSizeChange?.(event);
          context?.scrollFocusedInputIntoView();
        }}
      />
    );
  },
);
