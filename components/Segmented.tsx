import { Text, type JSX, View } from "nsh";
import { Button } from "nsh/base";

export interface SegmentedOption {
  id: string;
  label: string;
}

/** A small radio group drawn as pills: the setting's options are few and fixed. */
export function Segmented(props: { options: SegmentedOption[]; value: string; onSelect: (id: string) => void }) {
  return (
    <View class="flex-row gap-1 rounded-(--radius-pill) bg-muted p-1">
      <Each of={props.options} key={(option) => option.id}>
        {(option) => (
          <Button
            onPress={() => props.onSelect(option().id)}
            accessibilityLabel={option().label}
            class={
              props.value === option().id
                ? "rounded-(--radius-pill) bg-card px-3 py-1"
                : "rounded-(--radius-pill) px-3 py-1 active:opacity-60"
            }
          >
            <Text
              class={
                props.value === option().id
                  ? "text-[11px] font-medium text-foreground"
                  : "text-[11px] text-muted-foreground"
              }
            >
              {option().label}
            </Text>
          </Button>
        )}
      </Each>
    </View>
  );
}

export function SettingRow(props: { title: string; detail: string; children?: JSX.Element }) {
  return (
    <View class="flex-row items-center gap-4 border-b border-border px-5 py-3">
      <View class="flex-1 gap-0.5">
        <Text class="text-[13px] font-medium text-foreground">{props.title}</Text>
        <Text class="text-[11px] text-muted-foreground">{props.detail}</Text>
      </View>
      <View class="flex-row items-center gap-2">{props.children}</View>
    </View>
  );
}

export function SectionTitle(props: { text: string }) {
  return (
    <View class="px-5 pt-5 pb-1.5">
      <Text class="text-[10px] font-semibold tracking-wide text-muted-foreground">{props.text}</Text>
    </View>
  );
}
