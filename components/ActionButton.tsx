import { Text, View } from "nsh";
import { Button } from "nsh/base";

export interface IconButtonProps {
  testID?: string;
  label: string;
  /** What the screen reader says; also the button's tooltip in the status bar. */
  hint: string;
  onPress: () => void;
  tone?: "ghost" | "danger" | "primary";
  disabled?: boolean;
}

/** A small text button for a row's actions: the app has no icon set, so the words do the work. */
export function ActionButton(props: IconButtonProps) {
  const ghost = "text-muted-foreground hover:text-foreground active:opacity-60";
  const danger = "text-destructive hover:text-destructive active:opacity-60";
  const primary = "text-primary hover:text-primary active:opacity-60";
  const tone = () => props.tone ?? "ghost";
  return (
    <Button
      testID={props.testID}
      disabled={props.disabled ?? false}
      onPress={props.onPress}
      accessibilityLabel={props.hint}
      class="rounded-(--radius-pill) px-2.5 py-1 disabled:opacity-30"
    >
      <Text class={tone() === "danger" ? danger : tone() === "primary" ? primary : ghost}>{props.label}</Text>
    </Button>
  );
}

export function Pill(props: { text: string; class?: string }) {
  return (
    <View class={`rounded-(--radius-pill) px-2 py-0.5 ${props.class ?? "bg-muted"}`}>
      <Text class="text-[11px] font-medium">{props.text}</Text>
    </View>
  );
}
