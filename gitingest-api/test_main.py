import asyncio
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gitingest_api_main", pathlib.Path(__file__).with_name("main.py"))
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)


class CollectRepoDataTests(unittest.IsolatedAsyncioTestCase):
    async def test_collect_repo_data_returns_fallback_when_ingest_times_out(self):
        async def fake_fetch(*args, **kwargs):
            raise asyncio.TimeoutError()

        with patch.object(main, "fetch_github_content", side_effect=fake_fetch):
            response = await main.collect_repo_data({"username": "octocat", "repo": "Hello-World"})

        self.assertTrue(response["success"])
        self.assertEqual(response["data"]["files"], [])
        self.assertIn("summary", response["data"])
        self.assertIn("tree", response["data"])
        self.assertIn("content", response["data"])


if __name__ == "__main__":
    unittest.main()
