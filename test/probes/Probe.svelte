<script>
  import { QueryClient, setQueryClientContext } from "@tanstack/svelte-query";
  import { createGetPetQuery, createCreatePetMutation } from "@api/pets";

  // A real component: the hooks run where a Svelte app runs them.
  let { client, expose } = $props();
  setQueryClientContext(client);

  let id = $state("1");
  let later = $state(undefined);
  const query = createGetPetQuery(() => id);
  const waiting = createGetPetQuery(() => later);
  const mutation = createCreatePetMutation();

  expose({
    query,
    waiting,
    mutation,
    setId: (value) => (id = value),
    setLater: (value) => (later = value),
  });
</script>
