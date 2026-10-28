<script>
  import { setQueryClientContext } from "@tanstack/svelte-query";
  import { createGetTenantQuery, createListPagesInfiniteQuery } from "@api/edges";

  let { client, expose } = $props();
  setQueryClientContext(client);

  let tenant = $state("a");
  const query = createGetTenantQuery({}, () => ({ "X-Tenant-Id": tenant }));
  const pages = createListPagesInfiniteQuery(
    {},
    { "X-Tenant-Id": "t9" },
    { pageSize: 2 },
  );

  expose({ query, pages, setTenant: (value) => (tenant = value) });
</script>
