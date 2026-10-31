<script>
  import { QueryClient, setQueryClientContext } from "@tanstack/svelte-query";
  import { createGetPetQuery, createCreatePetMutation } from "@api/pets";

  // A real component: the hooks run where a Svelte app runs them.
  let { client, expose } = $props();
  setQueryClientContext(client);

  let id = $state("1");
  const query = createGetPetQuery(() => id);
  const mutation = createCreatePetMutation();

  expose({
    query,
    mutation,
    setId: (value) => (id = value),
  });
</script>
