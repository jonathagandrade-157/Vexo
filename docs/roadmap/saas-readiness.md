# VEXO — prontidão para venda

Atualizado em 2026-10-26. Este arquivo é a fonte de continuidade técnica;
itens só mudam para concluídos com evidência reproduzível.

## Estado dos fluxos

| Área | Estado | Evidência / próximo gate |
| --- | --- | --- |
| Catálogo, variantes, temas e storefront | Operacional | Smoke desktop/mobile publicado; manter regressão E2E. |
| Carrinho convidado | Correção pronta, não publicada | Token de posse, BFF e lockdown validados em unitários; falta CI Postgres/HTTP e GO de produção. |
| Checkout e pedido | Operacional com gates | Preço/estoque/frete no servidor; sandbox real de Mercado Pago ainda precisa de credenciais controladas. |
| Painel do lojista | Operacional parcial | Catálogo/pedidos/configurações funcionam; suporte e assinatura self-service continuam em breve. |
| Billing VEXO | Fundação parcial | Enforcement existe; compra, upgrade, downgrade, cancelamento e recuperação self-service faltam. |
| Operação e suporte | Parcial | Health/Sentry/CI existem; faltam SLO, rotina de incidentes, restore drill e canal de suporte vendável. |
| Legal/LGPD | Parcial | Termos/privacidade existem; faltam identidade legal final, retenção, exportação/exclusão e processo do titular. |

## Backlog priorizado

### P0 — bloquear venda até concluir

- [x] Eliminar enumeração/CRUD/RPC anônimos de carrinho no código e nas
  migrations.
- [x] Atualizar Next, Sentry, Zod, Vitest e transitivas vulneráveis; CI
  passa a executar `npm audit --audit-level=moderate`.
- [ ] CI remoto verde com Postgres real, PostgREST/Auth local, E2E e build.
- [ ] Confirmar identidade do projeto Supabase VEXO e executar Advisors.
- [ ] Aplicar expand/deploy/contract em produção com GO e smoke pós-deploy.
- [ ] Validar Mercado Pago sandbox ponta a ponta sem cobrança real.

### P1 — vendável com operação responsável

- [ ] Verificar em produção MFA dos administradores, política de senha,
  confirmação de e-mail, CAPTCHA/rate limits e URLs de redirect.
- [ ] Definir SLO, alertas acionáveis, ownership de incidentes e restore
  drill documentado de banco/storage.
- [ ] Entregar assinatura self-service (contratar, trocar plano,
  cancelar, falha de pagamento e reativar) com testes de idempotência.
- [ ] Concluir suporte, identidade legal, contato de privacidade,
  retenção e atendimento a exportação/exclusão de dados.
- [ ] Revisar CSP de report-only para enforcement gradual e configurar
  coleta de violações.

### P2 — escala comercial

- [ ] Observabilidade de funil, pedidos, pagamentos e falhas por tenant.
- [ ] Processo de domínio customizado com verificação e rollback.
- [ ] Gestão de clientes, marketing e relatórios sem ampliar acesso entre
  tenants.
- [ ] Teste periódico de autorização multi-tenant e varredura de
  dependências automatizada.

## Regras de liberação

Produção, migrations, cobranças, DNS, exclusão de dados e rotação de
credenciais exigem GO específico. Nenhum item é considerado pronto só
por revisão estática: precisa de teste no nível adequado e evidência do
ambiente em que será operado.
