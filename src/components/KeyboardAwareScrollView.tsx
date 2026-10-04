import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useRef,
} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
  type ScrollViewProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

type KeyboardAwareScrollViewProps = ScrollViewProps & {
  keyboardAvoidingViewStyle?: ViewStyle;
};

type KeyboardScrollContextValue = {
  contentRef: React.RefObject<View | null>;
  scrollTo: (y: number) => void;
};

const KeyboardScrollContext = createContext<KeyboardScrollContextValue | null>(null);

export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  keyboardAvoidingViewStyle,
  ...scrollProps
}: KeyboardAwareScrollViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const scrollTo = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 20), animated: true });
  }, []);

  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, keyboardAvoidingViewStyle]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <KeyboardScrollContext.Provider value={{ contentRef, scrollTo }}>
        <ScrollView
          {...scrollProps}
          ref={scrollRef}
          style={[{ flex: 1 }, scrollProps.style]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <View
            ref={contentRef}
            collapsable={false}
            style={[{ flexGrow: 1 }, contentContainerStyle]}
          >
            {children}
          </View>
        </ScrollView>
      </KeyboardScrollContext.Provider>
    </KeyboardAvoidingView>
  );
}

export const KeyboardAwareTextInput = forwardRef<TextInput, TextInputProps>(
  function KeyboardAwareTextInput({ onFocus, ...props }, forwardedRef) {
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
          const content = context?.contentRef.current;
          if (content && inputRef.current) {
            requestAnimationFrame(() => {
              inputRef.current?.measureLayout(
                content,
                (_x, y) => context?.scrollTo(y),
                () => undefined,
              );
            });
          }
        }}
      />
    );
  },
);
