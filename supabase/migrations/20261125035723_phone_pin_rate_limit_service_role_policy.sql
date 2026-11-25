drop policy if exists phone_pin_rate_limits_service_role_all on public.phone_pin_rate_limits;
create policy phone_pin_rate_limits_service_role_all
on public.phone_pin_rate_limits
for all
to service_role
using (true)
with check (true);