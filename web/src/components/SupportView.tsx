import { Button, Group, Stack, Text } from "@mantine/core";
import { Panel } from "./ui/Panel";

type SupportViewProps = {
  onBack: () => void;
};

/**
 * Quiet support / "buy me a coffee" page. Reachable from the NewSeasonForm
 * (the universal entry point — every fresh visitor lands here, and every
 * returning visitor who clears their save bounces back too). External
 * links open in a new tab so the in-progress career state (if any) on
 * a returning tab doesn't get blown away.
 *
 * No tracking, no metrics, no analytics on this page either — same
 * privacy posture as the rest of the app.
 */
export default function SupportView({ onBack }: SupportViewProps) {
  return (
    <Stack gap="md">
      <Text c="dimmed" size="sm" tt="uppercase">
        Apoiar o projeto
      </Text>

      <Panel title="Gandula">
        <Stack gap="sm">
          <Text>
            Gandula é um projeto pessoal — uma carta de amor aos simuladores
            de futebol em texto dos anos 90 (Elifoot, principalmente).
          </Text>
          <Text>
            Sem ads, sem tracking, sem servidor: tudo roda direto no seu
            navegador, e o código é aberto.
          </Text>
          <Text>
            Se está curtindo a experiência e quer ajudar a manter o projeto
            rolando, qualquer apoio é bem-vindo. Tudo vai pra manter as luzes
            acesas e a motivação alta pra novos features.
          </Text>

          <Group gap="sm">
            <Button
              component="a"
              href="https://ko-fi.com/felipedebene"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ko-fi
            </Button>
            <Button
              component="a"
              variant="default"
              href="https://github.com/felipedbene/gandula"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </Button>
          </Group>
        </Stack>
      </Panel>

      <Group justify="center">
        <Button variant="default" onClick={onBack}>
          Voltar
        </Button>
      </Group>
    </Stack>
  );
}
