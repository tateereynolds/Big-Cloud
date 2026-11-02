# Adopt the existing resources. These blocks are idempotent once imported.
import {
  to = azurerm_resource_group.focus
  id = "/subscriptions/${var.subscription_id}/resourceGroups/focus-studio-rg"
}

import {
  to = azurerm_service_plan.focus
  id = "/subscriptions/${var.subscription_id}/resourceGroups/focus-studio-rg/providers/Microsoft.Web/serverFarms/ASP-focusstudiorg-850e"
}

import {
  to = azurerm_linux_web_app.focus
  id = "/subscriptions/${var.subscription_id}/resourceGroups/focus-studio-rg/providers/Microsoft.Web/sites/focus-studio-tate"
}
