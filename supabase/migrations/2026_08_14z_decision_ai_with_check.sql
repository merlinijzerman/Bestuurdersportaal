-- Sprint 1 hardening: de restrictieve UPDATE-policy controleerde alleen de
-- bestaande rij (USING). Zonder WITH CHECK kon een toegestane update de nieuwe
-- decision_id/validatie_domein-combinatie buiten het toegestane domein zetten.
-- USING en WITH CHECK zijn bewust identiek: zowel bron- als doelrij moeten tot
-- het eigen fonds en het voor de rol toegestane validatiedomein behoren.

drop policy if exists "ai validatie domein"
  on public.decision_ai_interactions;

create policy "ai validatie domein"
  on public.decision_ai_interactions
  as restrictive
  for update
  using (
    decision_id in (
      select id
        from public.decision_objects
       where fonds_id = (
         select fonds_id from public.profielen where id = auth.uid()
       )
    )
    and (
      validatie_domein = 'algemeen'
      or (
        validatie_domein in ('risk','compliance','beleggingen','governance')
        and exists (
          select 1
            from public.profielen
           where id = auth.uid()
             and rol in ('voorzitter','beheerder')
        )
      )
    )
  )
  with check (
    decision_id in (
      select id
        from public.decision_objects
       where fonds_id = (
         select fonds_id from public.profielen where id = auth.uid()
       )
    )
    and (
      validatie_domein = 'algemeen'
      or (
        validatie_domein in ('risk','compliance','beleggingen','governance')
        and exists (
          select 1
            from public.profielen
           where id = auth.uid()
             and rol in ('voorzitter','beheerder')
        )
      )
    )
  );

comment on policy "ai validatie domein" on public.decision_ai_interactions is
  'Restrictief UPDATE-slot: USING valideert de bronrij; WITH CHECK valideert de doelrij tegen eigen fonds en toegestaan validatiedomein.';
