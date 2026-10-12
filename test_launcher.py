import io
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import launch


class LauncherTests(unittest.TestCase):
    def test_health_check_identifies_our_app(self):
        with patch('launch.urlopen', return_value=io.BytesIO(b'{"app":"another-app","status":"ok"}')):
            self.assertFalse(launch.is_ready(5050))
        with patch('launch.urlopen', return_value=io.BytesIO(b'{"app":"focus-studio","status":"ok"}')):
            self.assertTrue(launch.is_ready(5050))

    def test_reopening_reuses_running_app_without_starting_another_server(self):
        with patch.dict(os.environ, {'PORT':'5050'}), patch('launch.is_ready', return_value=True), \
             patch('launch.environment_python') as prepare, patch('launch.webbrowser.open') as browser:
            self.assertEqual(launch.main(['--no-browser']), 0)
            prepare.assert_not_called()
            browser.assert_not_called()

    def test_port_conflict_uses_available_local_port(self):
        server = Mock()
        server.poll.side_effect = [None, 0]
        server.wait.return_value = 0
        with patch.dict(os.environ, {'PORT':'5050'}), patch('launch.is_ready', side_effect=[False, True]), \
             patch('launch.port_available', side_effect=lambda port: port == 5051), \
             patch('launch.environment_python', return_value=Path('/test/python')), \
             patch('launch.subprocess.Popen', return_value=server) as start:
            self.assertEqual(launch.main(['--no-browser']), 0)
            self.assertEqual(start.call_args.kwargs['env']['PORT'], '5051')

    def test_failed_server_start_has_a_clear_error(self):
        server = Mock()
        server.poll.return_value = 1
        with patch.dict(os.environ, {'PORT':'5050'}), patch('launch.is_ready', return_value=False), \
             patch('launch.port_available', return_value=True), \
             patch('launch.environment_python', return_value=Path('/test/python')), \
             patch('launch.subprocess.Popen', return_value=server):
            self.assertEqual(launch.main(['--no-browser']), 1)

    def test_invalid_port_is_rejected_before_startup(self):
        with patch.dict(os.environ, {'PORT':'bad'}), patch('launch.environment_python') as prepare:
            self.assertEqual(launch.main(['--no-browser']), 1)
            prepare.assert_not_called()


if __name__ == '__main__':
    unittest.main()
