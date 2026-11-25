-- Restrict trigger-only SECURITY DEFINER functions from direct API/RPC execution.
revoke all on function public.asrar_set_order_snapshot() from public, anon, authenticated;
revoke all on function public.asrar_touch_thread() from public, anon, authenticated;
revoke all on function public.asrar_reserve_product_stock() from public, anon, authenticated;
revoke all on function public.asrar_restore_product_stock() from public, anon, authenticated;
