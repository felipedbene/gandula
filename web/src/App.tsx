import { useEffect, useState } from "react";
import init from "./wasm/gandula_wasm.js";
import { Container, Group, Stack, Text, Title } from "@mantine/core";
import { Footer } from "./components/Footer";
import { SeasonView } from "./components/SeasonView";

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("pronto");

  useEffect(() => {
    init()
      .then(() => setReady(true))
      .catch((e: unknown) =>
        setError(`Falha ao carregar o engine WASM: ${String(e)}`)
      );
  }, []);

  return (
    <Container size="sm" py="lg">
      <Stack gap="md">
        <Group justify="space-between" align="baseline">
          <Title order={1} c="phosphor.4" style={{ letterSpacing: "0.12em" }}>
            GANDULA
          </Title>
          <Text c="dimmed" size="sm">
            v0.5
          </Text>
        </Group>
        <Text c="dimmed" size="sm">
          Simulador de futebol em texto
        </Text>

        {error ? (
          <Text c="red" style={{ whiteSpace: "pre-wrap" }}>
            {error}
          </Text>
        ) : !ready ? (
          <Text c="dimmed">Carregando engine…</Text>
        ) : (
          <SeasonView onStatus={setStatus} />
        )}

        <Footer status={status} />
      </Stack>
    </Container>
  );
}
